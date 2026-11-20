import { Database } from 'bun:sqlite'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js/dist/sql-wasm.js'
import { Collection, Deck, DeckConfig, Note, Notetype, Package } from 'ankipack'

const testDirectory = mkdtempSync(path.join(tmpdir(),'ankikani-package-'))
process.env.ANKIKANI_DATA_DIR = testDirectory

let importer:typeof import('../server/package-import')
let owned:typeof import('../server/owned')
let packageBytes:Uint8Array

beforeAll(async () => {
  owned = await import('../server/owned')
  importer = await import('../server/package-import')
  const SQL = await initSqlJs({locateFile:(file)=>path.resolve('node_modules/sql.js/dist',file)})
  const notetype = Notetype.basicAndReversed({name:'Fixture Vocab'})
  const deck = new Deck({id:42,name:'Languages::German',config:new DeckConfig({
    id:77,name:'Fixture settings',newPerDay:7,reviewsPerDay:19,learnSteps:[2,15],relearnSteps:[20],desiredRetention:.88,maximumReviewInterval:900,
  })})
  deck.addNote(new Note({notetype,fields:['Hund','dog'],tags:['fixture']}))
  const pkg = new Package()
  pkg.addDeck(deck)
  pkg.addMedia('sound.mp3',new Uint8Array([1,2,3,4]))
  const data = await pkg.toCollection()
  const card = data.cards[0]
  card.type=2; card.queue=2; card.ivl=3; card.reps=2
  card.data=JSON.stringify({s:12.3456,d:7.25,lrt:Math.floor((Date.now()-5000)/1000)})
  card.due=Math.floor((Date.now()/1000-data.col.crt)/86400)
  data.revlog.push({id:Date.now()-1000,cid:card.id,usn:-1,ease:3,ivl:3,lastIvl:1,factor:2500,time:1200,type:1})
  packageBytes = await Collection.fromData(data).toUint8Array(SQL)
})

afterAll(() => {
  owned.closeCollection()
  rmSync(testDirectory,{recursive:true,force:true})
})

describe('direct Anki package import', () => {
  it('imports a scheduled modern apkg with hierarchy, settings, history, and media', async () => {
    const report = await importer.importPackageBytes(packageBytes,'fixture.apkg','apkg')
    expect(report).toMatchObject({kind:'apkg',decks:1,notes:1,cards:2,reviews:1,media:1})
    expect(report.compatibility).toEqual([expect.objectContaining({modelName:'Fixture Vocab',status:'review'})])
    const database = new Database(owned.collectionPath())
    expect(database.query('SELECT name FROM decks WHERE id=42').get()).toEqual({name:'Languages::German'})
    expect(database.query('SELECT ease FROM revlog').get()).toEqual({ease:3})
    expect(database.query('SELECT stability,difficulty FROM cards LIMIT 1').get()).toEqual({stability:12.3456,difficulty:7.25})
    expect(database.query('SELECT length(bytes) size FROM media WHERE name=?').get('sound.mp3')).toEqual({size:4})
    const settings = JSON.parse((database.query('SELECT value_json FROM settings WHERE deck_name=?').get('Languages::German') as {value_json:string}).value_json)
    database.close()
    expect(settings).toMatchObject({newPerDay:7,reviewsPerDay:19,maximumInterval:900,learningSteps:['2m','15m'],relearningSteps:['20m']})
    expect(settings.desiredRetention).toBeCloseTo(.88)
  })

  it('accepts the collection package extension and backs up the active collection', async () => {
    const report = await importer.importPackageBytes(packageBytes,'collection.colpkg','colpkg')
    expect(report.kind).toBe('colpkg')
    expect(report.backup).toBeTruthy()
    expect(existsSync(report.backup!)).toBe(true)
  })

  it('rejects damaged package bytes without replacing the collection', async () => {
    const before = new Database(owned.collectionPath()).query('SELECT COUNT(*) count FROM cards').get()
    await expect(importer.importPackageBytes(new Uint8Array([1,2,3]),'broken.apkg','apkg')).rejects.toThrow()
    const database = new Database(owned.collectionPath())
    expect(database.query('SELECT COUNT(*) count FROM cards').get()).toEqual(before)
    database.close()
  })

  it('rejects concurrent collection replacements', async () => {
    const { beginCollectionImport } = await import('../server/collection-import')
    const active = beginCollectionImport()
    try { expect(() => beginCollectionImport()).toThrow('already running') }
    finally { active.release() }
  })

  it('recovers a lock left by a dead process', async () => {
    const { beginCollectionImport } = await import('../server/collection-import')
    writeFileSync(`${owned.collectionPath()}.import.lock`,JSON.stringify({pid:2147483647,token:'dead'}))
    const active=beginCollectionImport()
    active.release()
    expect(existsSync(`${owned.collectionPath()}.import.lock`)).toBe(false)
  })
})
