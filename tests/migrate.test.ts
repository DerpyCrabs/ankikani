import { Database } from 'bun:sqlite'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it('releases the staging collection after a failed migration and imports review history on retry', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ankikani-migrate-'))
  vi.stubEnv('ANKIKANI_DATA_DIR', directory)
  const { migrateFromAnki } = await import('../server/migrate')
  const fields = { Front: { value: 'one', order: 0 }, Back: { value: 'eins', order: 1 } }
  const firstReview = Date.UTC(2026, 0, 1)
  const responses: Record<string, unknown> = {
    getActiveProfile: 'Migration test', deckNamesAndIds: { German: 1 }, findCards: [10],
    cardsInfo: [{ cardId: 10, note: 1, deckName: 'German', modelName: 'Basic', ord: 0, fields,
      question: 'one', answer: 'eins', interval: 2, type: 2, queue: 2, due: 20, reps: 2,
      lapses: 0, left: 0, mod: 0, flags: 0 }],
    notesInfo: [{ noteId: 1, modelName: 'Basic', fields, tags: [] }],
    modelFieldNames: ['Front', 'Back'], modelTemplates: { Forward: { Front: '{{Front}}', Back: '{{Back}}' } },
    cardReviews: [[firstReview, 10, 0, 3, 1, 0, 0, 500, 0], [firstReview + 86400000, 10, 0, 3, 2, 1, 0, 500, 1]],
    getMediaFilesNames: ['test.mp3'], getDeckConfig: false, retrieveMediaFile: false,
  }
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const { action, params } = JSON.parse(init.body)
    if (!(action in responses)) throw new Error('Unexpected Anki action ' + action)
    const result = action === 'findCards' && params.query.includes('prop:due<=')
      ? Number(params.query.split('<=').at(-1)) >= 0 ? [10] : []
      : responses[action]
    return Response.json({ result, error: null })
  }))

  try {
    await expect(migrateFromAnki()).rejects.toThrow('media files could not be copied')
    expect(readdirSync(directory)).toEqual([])
    responses.retrieveMediaFile = 'YXVkaW8='
    const report = await migrateFromAnki()
    expect(report).toMatchObject({ profile: 'Migration test', notes: 1, cards: 1, reviews: 2, media: 1 })
    const db = new Database(path.join(directory, 'ankikani.sqlite'), { readonly: true })
    try {
      const card = db.query('SELECT stability, difficulty, last_review FROM cards WHERE id=10').get() as {
        stability: number; difficulty: number; last_review: number
      }
      expect(card.stability).toBeGreaterThan(0)
      expect(card.difficulty).toBeGreaterThan(0)
      expect(card.last_review).toBe(firstReview + 86400000)
    } finally { db.close() }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
