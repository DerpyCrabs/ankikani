import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs from 'sql.js/dist/sql-wasm.js'
import { Collection, Deck, DeckConfig, Note, Notetype, Package } from 'ankipack'

const directory = mkdtempSync(path.join(tmpdir(), 'ankikani-import-regressions-'))
const deckName = 'Import regressions'
const day = 86_400_000
const today = new Date(2026, 0, 15).getTime()
const literals = ['plain text', 'literal $& value', 'literal $$ value', 'literal $` value', "literal $' value"]
let owned: typeof import('../server/owned') | undefined
let database: Database | undefined

beforeAll(async () => {
  vi.stubEnv('ANKIKANI_DATA_DIR', directory)
  // Freeze only Date: SQL WASM and the import's async work still use real timers.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(today + 12 * 60 * 60 * 1000)
  owned = await import('../server/owned')
  const { importPackageBytes } = await import('../server/package-import')
  const SQL = await initSqlJs({ locateFile: (file) => path.resolve('node_modules/sql.js/dist', file) })
  const notetype = new Notetype({
    name: 'Literal fields',
    fields: [{ name: 'Front' }, { name: 'Back' }],
    templates: [{ name: 'Card', questionFormat: '<b>{{Front}}</b>', answerFormat: '<i>{{Back}}</i>' }],
  })
  const deck = new Deck({
    id: 42,
    name: deckName,
    config: new DeckConfig({ id: 77, name: 'Zero quotas', newPerDay: 0, reviewsPerDay: 0 }),
  })
  const schedules = [
    { name: 'day-learning', type: 1, queue: 3, due: 15 },
    { name: 'buried-review', type: 2, queue: -2, due: 22 },
    { name: 'day-relearning', type: 3, queue: 3, due: 15 },
    { name: 'user-buried-review', type: 2, queue: -3, due: 22 },
    { name: 'buried-day-learning', type: 1, queue: -2, due: 15 },
    { name: 'buried-intraday-relearning', type: 3, queue: -3, due: (today + 13 * 60 * 60 * 1000) / 1000 },
    { name: 'suspended-review', type: 2, queue: -1, due: 22 },
    { name: 'review-control', type: 2, queue: 2, due: 22 },
    { name: 'intraday-control', type: 1, queue: 1, due: (today + 13 * 60 * 60 * 1000) / 1000 },
    { name: 'new-control', type: 0, queue: 0, due: 7 },
  ]
  for (const { name } of schedules) deck.addNote(new Note({ notetype, fields: [name, 'answer'] }))
  for (const literal of literals) deck.addNote(new Note({ notetype, fields: [literal, literal] }))
  // A literal in the question template isolates FrontSide from field replacement.
  const frontSideType = new Notetype({
    name: 'Literal FrontSide',
    fields: [{ name: 'Front' }],
    templates: [{ name: 'Card', questionFormat: '{{Front}} $&', answerFormat: '<section>{{FrontSide}}</section>' }],
  })
  deck.addNote(new Note({ notetype: frontSideType, fields: ['front-side'] }))
  const pkg = new Package()
  pkg.addDeck(deck)
  const data = await pkg.toCollection()
  data.col.crt = new Date(2026, 0, 1).getTime() / 1000
  for (const { name, type, queue, due } of schedules) {
    const note = data.notes.find((note) => note.flds.startsWith(`${name}\x1f`))!
    Object.assign(data.cards.find((card) => card.nid === note.id)!, { type, queue, due })
  }
  const bytes = await Collection.fromData(data).toUint8Array(SQL)
  await importPackageBytes(bytes, 'regressions.apkg', 'apkg')
  database = new Database(owned.collectionPath(), { readonly: true })
})

afterAll(() => {
  database?.close()
  owned?.closeCollection()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  rmSync(directory, { recursive: true, force: true })
})

function cardFor(field: string) {
  return database!.query(`
    SELECT c.question, c.answer, c.due_at, c.queue, c.buried_until
    FROM cards c JOIN notes n ON n.id = c.note_id
    WHERE json_extract(n.fields_json, '$.Front.value') = ?
  `).get(field)
}

describe('imported due dates', () => {
  it('imports a day-learning card due tomorrow as a day offset', () => {
    expect(cardFor('day-learning')).toMatchObject({ due_at: today + day, buried_until: null })
  })

  it('preserves a buried review due eight days ahead when burial expires tomorrow', () => {
    expect(cardFor('buried-review')).toMatchObject({ due_at: today + 8 * day, queue: 2, buried_until: today + day })
  })

  it.each([
    ['day-relearning', today + day, 3, null],
    ['user-buried-review', today + 8 * day, 2, today + day],
    ['buried-day-learning', today + day, 3, today + day],
    ['buried-intraday-relearning', today + 13 * 60 * 60 * 1000, 1, today + day],
    ['suspended-review', today + 8 * day, -1, null],
  ] as const)('preserves the schedule and availability of %s', (name, due_at, queue, buried_until) => {
    expect(cardFor(name)).toMatchObject({ due_at, queue, buried_until })
  })

  it('preserves ordinary review dates, intraday timestamps, and new-card order', () => {
    expect(cardFor('review-control')).toMatchObject({ due_at: today + 8 * day, queue: 2 })
    expect(cardFor('intraday-control')).toMatchObject({ due_at: today + 13 * 60 * 60 * 1000, queue: 1 })
    expect(cardFor('new-control')).toMatchObject({ due_at: 7, queue: 0 })
  })
})

it('preserves explicit zero daily new-card and review quotas', () => {
  const row = database!.query('SELECT value_json FROM settings WHERE deck_name = ?').get(deckName) as { value_json: string }
  expect(JSON.parse(row.value_json)).toMatchObject({ newPerDay: 0, reviewsPerDay: 0 })
})

describe('literal card text', () => {
  it.each(literals)('preserves %s in both field substitutions', (literal) => {
    expect(cardFor(literal)).toMatchObject({ question: `<b>${literal}</b>`, answer: `<i>${literal}</i>` })
  })

  it('preserves literal dollar sequences when inserting FrontSide', () => {
    expect(cardFor('front-side')).toMatchObject({ question: 'front-side $&', answer: '<section>front-side $&</section>' })
  })
})
