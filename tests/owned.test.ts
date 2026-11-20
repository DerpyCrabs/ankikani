import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const neuralRuntime = vi.hoisted(() => ({ rwkvAvailable: vi.fn(() => false), refreshReviewScores: vi.fn() }))
vi.mock('../server/rwkv/refresh', () => neuralRuntime)

const testDirectory = mkdtempSync(path.join(tmpdir(), 'ankikani-owned-'))
process.env.ANKIKANI_DATA_DIR = testDirectory

let owned: typeof import('../server/owned')

beforeAll(async () => {
  owned = await import('../server/owned')
  const database = new Database(owned.collectionPath())
  owned.createSchema(database)
  database.query('INSERT INTO meta VALUES(?,?)').run('profile','Test')
  database.query('INSERT INTO decks VALUES(?,?)').run(1,'Deck')
  database.query('INSERT INTO models VALUES(?,?,?)').run('Basic','["Front","Back"]','{"Card 1":{"Front":"{{Front}}","Back":"{{Back}}"}}')
  database.query('INSERT INTO notes VALUES(?,?,?,?)').run(10,'Basic','{"Front":{"value":"one","order":0},"Back":{"value":"eins","order":1}}','[]')
  const insert = database.query(`INSERT INTO cards(id,note_id,deck_name,ord,question,answer,interval,type,queue,due,due_at,reps,lapses,remaining,modified,flags,stability,difficulty,scheduled_days,learning_steps,last_review)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  insert.run(100,10,'Deck',0,'one','eins',3,2,2,0,Date.now()-1000,2,0,0,0,0,3,5.5,3,0,Date.now()-3*86400000)
  insert.run(101,10,'Deck',1,'eins','one',3,2,2,0,Date.now()-1000,2,0,0,0,0,3,5.5,3,0,Date.now()-3*86400000)
  database.query('INSERT INTO settings VALUES(?,?)').run('Deck',JSON.stringify({...owned.DEFAULT_SETTINGS,burySiblings:true}))
  database.close()
})

afterAll(() => {
  owned.closeCollection()
  rmSync(testDirectory,{recursive:true,force:true})
})

describe('owned collection scheduler', () => {
  it('keeps a due sibling out of the same review session', () => {
    const config = owned.getOwnedDeckProfile('Deck').suggestedConfig!
    expect(owned.getOwnedReviewSession('Deck',config).cards).toHaveLength(1)
  })

  it('ranks due reviews before sibling selection and ignores obsolete scores', () => {
    const database = new Database(owned.collectionPath())
    const config = owned.getOwnedDeckProfile('Deck').suggestedConfig!
    const previous = Date.now() - 86400000
    const today = new Date().toLocaleDateString('sv-SE')
    database.query('INSERT INTO revlog(id,card_id,ease) VALUES(?,?,3)').run(previous,101)
    database.query('INSERT INTO instant_scores VALUES(?,?,?,?)').run(101,previous,today,0.3)
    try {
      neuralRuntime.rwkvAvailable.mockReturnValue(true)
      owned.updateOwnedSettings('Deck',{...owned.DEFAULT_SETTINGS,neuralReviewOrder:false})
      expect(owned.getOwnedReviewSession('Deck',config).cards[0].cardId).toBe(100)
      owned.updateOwnedSettings('Deck',{...owned.DEFAULT_SETTINGS,neuralReviewOrder:true})
      neuralRuntime.rwkvAvailable.mockReturnValue(false)
      expect(owned.getOwnedReviewSession('Deck',config).cards[0].cardId).toBe(100)
      neuralRuntime.rwkvAvailable.mockReturnValue(true)
      expect(owned.getOwnedReviewSession('Deck',config).cards.map(card => card.cardId)).toEqual([101])
      database.query('INSERT INTO revlog(id,card_id,ease) VALUES(?,?,3)').run(previous+1,101)
      expect(owned.getOwnedReviewSession('Deck',config).cards.map(card => card.cardId)).toEqual([100])
    } finally {
      neuralRuntime.rwkvAvailable.mockReturnValue(false)
      database.query('DELETE FROM instant_scores WHERE card_id=101').run()
      database.query('DELETE FROM revlog WHERE card_id=101').run()
      database.close()
    }
  })

  it('grades once, persists FSRS state, and buries the sibling', () => {
    expect(owned.answerOwnedCard(100,3,'request-1')).toEqual({saved:true,cardId:100,ease:3})
    expect(owned.answerOwnedCard(100,3,'request-1')).toEqual({saved:true,cardId:100,ease:3})
    const database = new Database(owned.collectionPath())
    const answered = database.query('SELECT queue,due_at,reps FROM cards WHERE id=100').get() as {queue:number;due_at:number;reps:number}
    const sibling = database.query('SELECT buried_until FROM cards WHERE id=101').get() as {buried_until:number}
    const logs = database.query('SELECT kind FROM revlog').all()
    database.close()
    expect(answered.queue).toBe(2)
    expect(answered.due_at).toBeGreaterThan(Date.now())
    expect(answered.reps).toBe(3)
    expect(sibling.buried_until).toBeGreaterThan(Date.now())
    expect(logs).toEqual([{kind:1}])
  })

  it('enforces the review limit across sessions and avoids revlog ID collisions', () => {
    owned.updateOwnedSettings('Deck',{...owned.DEFAULT_SETTINGS,reviewsPerDay:1})
    const database = new Database(owned.collectionPath())
    database.query('UPDATE cards SET buried_until=NULL,due_at=?,queue=2,type=2 WHERE id=101').run(Date.now()-1000)
    database.query('UPDATE revlog SET id=?').run(Date.now()+10_000)
    database.close()
    const config = owned.getOwnedDeckProfile('Deck').suggestedConfig!
    expect(owned.getOwnedReviewSession('Deck',config).cards).toHaveLength(0)
    expect(owned.answerOwnedCard(101,3,'request-2')).toMatchObject({saved:true})
    const reopened = new Database(owned.collectionPath())
    const ids = reopened.query('SELECT id FROM revlog ORDER BY id').all() as Array<{id:number}>
    reopened.close()
    expect(ids[1].id).toBeGreaterThan(ids[0].id)
  })

  it('rejects invalid scheduling settings', () => {
    expect(() => owned.updateOwnedSettings('Deck',{...owned.DEFAULT_SETTINGS,desiredRetention:1})).toThrow('Desired retention')
    expect(() => owned.updateOwnedSettings('Deck',{...owned.DEFAULT_SETTINGS,learningSteps:[]})).toThrow('Steps')
    expect(() => owned.updateOwnedSettings('Deck',{...owned.DEFAULT_SETTINGS,maximumInterval:0})).toThrow('Maximum interval')
  })
})
