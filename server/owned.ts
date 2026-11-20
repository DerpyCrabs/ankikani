import { Database } from 'bun:sqlite'
import path from 'node:path'
import { mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { Rating, State, createEmptyCard, fsrs, type Card } from 'ts-fsrs'
import { adaptCard, buildDeckConfig } from '../src/lib/adapters'
import type {
  AnkiCardInfo, DashboardData, DeckProfile, DeckSummary, LessonPayload,
  SessionPayload, StudyCard, StudyConfig, SchedulingSettings,
} from '../src/lib/domain'
import { activeSpread, buildStudyQueue, calculateStreak } from '../src/lib/study'

const DATA_DIR = process.env.ANKIKANI_DATA_DIR ?? path.resolve(import.meta.dir, '..', 'data')
const DB_PATH = path.join(DATA_DIR, 'ankikani.sqlite')
mkdirSync(DATA_DIR, { recursive: true })

let database: Database | null = null

export const DEFAULT_SETTINGS: SchedulingSettings = {
  newPerDay: 20,
  reviewsPerDay: 200,
  desiredRetention: 0.9,
  maximumInterval: 36500,
  learningSteps: ['1m', '10m'],
  relearningSteps: ['10m'],
  leechThreshold: 8,
  burySiblings: true,
}

function db() {
  if (!database) {
    database = new Database(DB_PATH, { create: true })
    database.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000')
    createSchema(database)
  }
  return database
}

export function createSchema(target: Database) {
  target.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS decks (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS models (
      name TEXT PRIMARY KEY, fields_json TEXT NOT NULL, templates_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY, model_name TEXT NOT NULL, fields_json TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]', FOREIGN KEY(model_name) REFERENCES models(name)
    );
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY, note_id INTEGER NOT NULL, deck_name TEXT NOT NULL, ord INTEGER NOT NULL,
      question TEXT NOT NULL, answer TEXT NOT NULL, interval INTEGER NOT NULL, type INTEGER NOT NULL,
      queue INTEGER NOT NULL, due INTEGER NOT NULL, due_at INTEGER NOT NULL, reps INTEGER NOT NULL,
      lapses INTEGER NOT NULL, remaining INTEGER NOT NULL, modified INTEGER NOT NULL, flags INTEGER NOT NULL,
      buried_until INTEGER, leech INTEGER NOT NULL DEFAULT 0,
      stability REAL NOT NULL DEFAULT 0, difficulty REAL NOT NULL DEFAULT 0,
      scheduled_days INTEGER NOT NULL DEFAULT 0, learning_steps INTEGER NOT NULL DEFAULT 0,
      last_review INTEGER, FOREIGN KEY(note_id) REFERENCES notes(id)
    );
    CREATE INDEX IF NOT EXISTS cards_deck_due ON cards(deck_name, queue, due_at);
    CREATE INDEX IF NOT EXISTS cards_note ON cards(note_id);
    CREATE TABLE IF NOT EXISTS revlog (
      id INTEGER PRIMARY KEY, card_id INTEGER NOT NULL, ease INTEGER NOT NULL,
      interval INTEGER NOT NULL DEFAULT 0, last_interval INTEGER NOT NULL DEFAULT 0,
      time_ms INTEGER NOT NULL DEFAULT 0, kind INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(card_id) REFERENCES cards(id)
    );
    CREATE INDEX IF NOT EXISTS revlog_card ON revlog(card_id, id);
    CREATE TABLE IF NOT EXISTS media (name TEXT PRIMARY KEY, bytes BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (
      deck_name TEXT PRIMARY KEY, value_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS answer_requests (
      request_id TEXT PRIMARY KEY, card_id INTEGER NOT NULL, ease INTEGER NOT NULL, result_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS daily_activity (
      day TEXT NOT NULL, deck_name TEXT NOT NULL, new_introduced INTEGER NOT NULL DEFAULT 0,
      reviews_completed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day, deck_name)
    );
  `)
  try { target.exec('ALTER TABLE cards ADD COLUMN buried_until INTEGER') } catch {}
  try { target.exec('ALTER TABLE cards ADD COLUMN leech INTEGER NOT NULL DEFAULT 0') } catch {}
}

export function collectionExists() {
  return existsSync(DB_PATH) && Boolean(db().query("SELECT value FROM meta WHERE key='profile'").get())
}

export function collectionPath() { return DB_PATH }

export function closeCollection() {
  database?.close()
  database = null
}

export function backupCollection() {
  if (!existsSync(DB_PATH)) return null
  closeCollection()
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const destination = path.join(DATA_DIR, `ankikani-${stamp}.sqlite`)
  copyFileSync(DB_PATH, destination)
  return destination
}

type CardRow = {
  id: number; note_id: number; deck_name: string; ord: number; question: string; answer: string
  interval: number; type: number; queue: number; due: number; due_at: number; reps: number
  lapses: number; remaining: number; modified: number; flags: number; stability: number
  difficulty: number; scheduled_days: number; learning_steps: number; last_review: number | null
  buried_until: number | null; leech: number
  model_name: string; fields_json: string
}

function ankiCard(row: CardRow): AnkiCardInfo {
  return {
    cardId: row.id, note: row.note_id, deckName: row.deck_name, ord: row.ord,
    question: row.question, answer: row.answer, interval: row.interval, type: row.type,
    queue: row.queue, due: row.due, reps: row.reps, lapses: row.lapses, left: row.remaining,
    mod: row.modified, flags: row.flags, modelName: row.model_name,
    fields: JSON.parse(row.fields_json), fieldOrder: 0,
  }
}

function rowsForDeck(deckName: string, suffix = '', params: unknown[] = []) {
  const prefix = `${deckName}::%`
  return db().query(`SELECT c.*, n.model_name, n.fields_json FROM cards c JOIN notes n ON n.id=c.note_id
    WHERE (c.deck_name=? OR c.deck_name LIKE ?) ${suffix}`).all(...([deckName, prefix, ...params] as never[])) as CardRow[]
}

function mapped(deckName: string, config: StudyConfig, rows = rowsForDeck(deckName)) {
  return rows.map((row) => {
    const card = adaptCard(ankiCard(row), config)
    return card ? { ...card, leech:Boolean(row.leech) } : null
  }).filter((card): card is NonNullable<typeof card> => card !== null)
}

export function getOwnedSettings(deckName: string): SchedulingSettings {
  const row = db().query('SELECT value_json FROM settings WHERE deck_name=?').get(deckName) as { value_json: string } | null
  return row ? { ...DEFAULT_SETTINGS, ...JSON.parse(row.value_json) } : DEFAULT_SETTINGS
}

export function updateOwnedSettings(deckName: string, value: SchedulingSettings) {
  if (!Number.isInteger(value.newPerDay) || value.newPerDay < 0 || !Number.isInteger(value.reviewsPerDay) || value.reviewsPerDay < 0) throw new Error('Daily limits must be non-negative integers.')
  if (value.desiredRetention < 0.7 || value.desiredRetention > 0.99) throw new Error('Desired retention must be between 0.70 and 0.99.')
  if (!Number.isInteger(value.maximumInterval) || value.maximumInterval < 1) throw new Error('Maximum interval must be a positive integer.')
  if (!Number.isInteger(value.leechThreshold) || value.leechThreshold < 1) throw new Error('Leech threshold must be a positive integer.')
  const validStep = (item: string) => /^\d+(?:\.\d+)?[mhd]$/.test(item)
  if (!value.learningSteps.length || !value.relearningSteps.length || !value.learningSteps.every(validStep) || !value.relearningSteps.every(validStep)) throw new Error('Steps must contain values such as 1m, 10m, 1h, or 1d.')
  if (value.fsrsWeights && (!value.fsrsWeights.length || value.fsrsWeights.some((item) => !Number.isFinite(item)))) throw new Error('FSRS weights must be finite numbers.')
  db().query('INSERT INTO settings VALUES(?,?) ON CONFLICT(deck_name) DO UPDATE SET value_json=excluded.value_json').run(deckName, JSON.stringify(value))
  return value
}

export function ownedHealth() {
  const profile = db().query("SELECT value FROM meta WHERE key='profile'").get() as { value: string } | null
  return { connected: Boolean(profile), version: 1, endpoint: DB_PATH, profileName: profile?.value ?? 'AnkiKani' }
}

export function listOwnedDecks(): DeckSummary[] {
  return (db().query('SELECT id, name FROM decks ORDER BY name').all() as Array<{id:number;name:string}>).map((deck) => {
    const names = db().query(`SELECT DISTINCT n.model_name name FROM cards c JOIN notes n ON n.id=c.note_id
      WHERE c.deck_name=? OR c.deck_name LIKE ?`).all(deck.name, `${deck.name}::%`) as Array<{name:string}>
    return { id: deck.id, name: deck.name, supported: names.length > 0, modelNames: names.map((item) => item.name) }
  })
}

export function getOwnedDeckProfile(deckName: string): DeckProfile {
  const models = db().query(`SELECT DISTINCT m.* FROM models m JOIN notes n ON n.model_name=m.name
    JOIN cards c ON c.note_id=n.id WHERE c.deck_name=? OR c.deck_name LIKE ?`).all(deckName, `${deckName}::%`) as Array<{name:string;fields_json:string;templates_json:string}>
  const fieldsByModel: Record<string,string[]> = {}
  const templatesByModel: DeckProfile['templatesByModel'] = {}
  const samplesByModel: Record<string,AnkiCardInfo[]> = {}
  for (const model of models) {
    fieldsByModel[model.name] = JSON.parse(model.fields_json)
    templatesByModel[model.name] = JSON.parse(model.templates_json)
    samplesByModel[model.name] = rowsForDeck(deckName, 'AND n.model_name=? LIMIT 3', [model.name]).map(ankiCard)
  }
  const detected = buildDeckConfig(deckName, models.map((model) => ({
    modelName: model.name, fields: fieldsByModel[model.name], templates: templatesByModel[model.name],
    templateCount: Object.keys(templatesByModel[model.name]).length, samples: samplesByModel[model.name],
    noteCount: Number((db().query(`SELECT COUNT(DISTINCT n.id) count FROM notes n JOIN cards c ON c.note_id=n.id
      WHERE n.model_name=? AND (c.deck_name=? OR c.deck_name LIKE ?)`).get(model.name,deckName,`${deckName}::%`) as {count:number}).count),
  })))
  return { deckName, modelNames: models.map((model) => model.name), fieldsByModel, templatesByModel,
    samplesByModel, suggestedMapping: null, suggestedConfig: detected.config, compatibility: detected.compatibility }
}

function dueRows(deckName: string, kind: 'review' | 'learning' | 'new', limit: number) {
  const now = Date.now()
  const clause = (kind === 'new' ? 'c.queue=0' : kind === 'learning'
    ? 'c.queue IN (1,3) AND c.due_at<=?' : 'c.queue=2 AND c.due_at<=?'
    ) + ' AND (c.buried_until IS NULL OR c.buried_until<=unixepoch()*1000)'
  const args = kind === 'new' ? [deckName, `${deckName}::%`, limit] : [deckName, `${deckName}::%`, now, limit]
  return db().query(`SELECT c.*, n.model_name, n.fields_json FROM cards c JOIN notes n ON n.id=c.note_id
    WHERE (c.deck_name=? OR c.deck_name LIKE ?) AND ${clause} ORDER BY c.due_at,c.id LIMIT ?`).all(...args) as CardRow[]
}

const dayKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`

function remainingLimits(deckName:string) {
  const settings = getOwnedSettings(deckName)
  const activity = db().query(`SELECT COALESCE(SUM(new_introduced),0) new_introduced,COALESCE(SUM(reviews_completed),0) reviews_completed
    FROM daily_activity WHERE day=? AND (deck_name=? OR deck_name LIKE ?)`).get(dayKey(),deckName,`${deckName}::%`) as {new_introduced:number;reviews_completed:number}|null
  return {
    newCards:Math.max(0,settings.newPerDay-(activity?.new_introduced ?? 0)),
    reviews:Math.max(0,settings.reviewsPerDay-(activity?.reviews_completed ?? 0)),
  }
}

function oneSiblingPerNote(rows:CardRow[], bury:boolean) {
  if (!bury) return rows
  const seen = new Set<number>()
  return rows.filter((row) => seen.has(row.note_id) ? false : (seen.add(row.note_id),true))
}

export function getOwnedReviewSession(deckName: string, config: StudyConfig): SessionPayload {
  const settings = getOwnedSettings(deckName)
  const reviewLimit = remainingLimits(deckName).reviews
  let reviews = 0
  const rows = oneSiblingPerNote([
    ...dueRows(deckName, 'learning', 10000),
    ...dueRows(deckName, 'review', Math.max(reviewLimit*4,reviewLimit)),
  ],settings.burySiblings).filter((row) => row.queue!==2 || ++reviews<=reviewLimit)
  return { deckName, cards: buildStudyQueue(mapped(deckName, config, rows)) }
}

export function getOwnedLessonSession(deckName: string, config: StudyConfig): LessonPayload {
  const remaining = remainingLimits(deckName).newCards
  const candidates = mapped(deckName, config, dueRows(deckName, 'new', Math.max(remaining * 4, remaining)))
  const groups = new Map<number,StudyCard[]>()
  for (const card of candidates) groups.set(card.noteId, [...(groups.get(card.noteId) ?? []), card])
  const selected:StudyCard[][] = []
  let selectedCards = 0
  for (const cards of groups.values()) {
    if (selected.length === 5 || selectedCards + cards.length > remaining) continue
    selected.push(cards); selectedCards += cards.length
  }
  const items = selected.map((cards) => { const card = cards[0]; return {
    noteId: card.noteId, sourceWord: card.sourceWord, targetMeaning: card.targetMeaning,
    sourceExample: card.sourceExample, targetExample: card.targetExample, note: card.note,
    audioFilename: card.audioFilename, cards, contentKind: card.contentKind,
    promptAudioFilename: card.promptAudioFilename, promptAudioFilenames: card.promptAudioFilenames,
    audioFilenames: card.audioFilenames, imageFilenames: card.promptImageFilenames, details: card.details,
  }})
  return { deckName, items, quizCards: buildStudyQueue(selected.flat()) }
}

export function getOwnedCards(ids: number[], deckName: string, config: StudyConfig) {
  if (!ids.length) return []
  const placeholders = ids.map(() => '?').join(',')
  return mapped(deckName, config, rowsForDeck(deckName, `AND c.id IN (${placeholders})`, ids))
}

export function getOwnedDashboard(deckName: string, config: StudyConfig): DashboardData {
  const cards = mapped(deckName, config)
  const now = new Date()
  const logs = db().query(`SELECT r.id FROM revlog r JOIN cards c ON c.id=r.card_id
    WHERE (c.deck_name=? OR c.deck_name LIKE ?) AND r.ease>0 ORDER BY r.id`).all(deckName, `${deckName}::%`) as Array<{id:number}>
  const streak = calculateStreak(logs.map((item) => item.id), now)
  const limits = remainingLimits(deckName)
  const settings = getOwnedSettings(deckName)
  let reviewCount = 0
  const due = oneSiblingPerNote([
    ...dueRows(deckName,'learning',10000),
    ...dueRows(deckName,'review',Math.max(limits.reviews*4,limits.reviews)),
  ],settings.burySiblings).filter((row)=>row.queue!==2 || ++reviewCount<=limits.reviews)
  const learningDue = due.filter((row)=>row.queue!==2)
  const reviewDue = due.filter((row)=>row.queue===2)
  const spread = activeSpread(cards)
  const forecast = Array.from({ length: 7 }, (_, offset) => {
    const start = new Date(); start.setHours(0,0,0,0); start.setDate(start.getDate()+offset)
    const end = new Date(start); end.setDate(end.getDate()+1)
    const ids = rowsForDeck(deckName, `AND c.queue>0 AND c.due_at>=? AND c.due_at<?
      AND (c.buried_until IS NULL OR c.buried_until<=unixepoch()*1000)`, [start.getTime(), end.getTime()]).map((row) => row.id)
    const date = `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`
    return { date, label: offset === 0 ? 'Today' : start.toLocaleDateString(undefined,{weekday:'short'}), count: ids.length, cardIds: ids }
  })
  const dateKey = (date:Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
  const today = dateKey(now)
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate()-1)
  const countDay = (key:string) => logs.filter((item) => dateKey(new Date(item.id)) === key).length
  return { deckName, lessonsAvailable: Math.min(new Set(cards.filter((c)=>c.queue===0).map((c)=>c.noteId)).size, limits.newCards),
    reviewsDue: reviewDue.length + learningDue.length, learning: learningDue.length,
    completedToday: countDay(today), completedYesterday: countDay(dateKey(yesterday)),
    currentStreak: streak.current, bestStreak: streak.best, dueToday: forecast[0].count,
    forecast, activeSpread: spread.stages, spreadLegend: spread.legend, totalCards: cards.length, updatedAt: now.toISOString() }
}

function fsrsCard(row: CardRow): Card {
  const state = row.type === 0 ? State.New : row.type === 1 ? State.Learning : row.type === 3 ? State.Relearning : State.Review
  return { ...createEmptyCard(new Date(row.due_at)), state, due: new Date(row.due_at), stability: row.stability || Math.max(.1,row.interval),
    difficulty: row.difficulty || 5.5, scheduled_days: row.scheduled_days || row.interval,
    learning_steps: row.learning_steps, reps: row.reps, lapses: row.lapses,
    last_review: row.last_review ? new Date(row.last_review) : undefined }
}

export function answerOwnedCard(cardId: number, ease: 1 | 3, requestId?: string) {
  const store = db()
  if (requestId) {
    const prior = store.query('SELECT card_id,ease,result_json FROM answer_requests WHERE request_id=?').get(requestId) as {card_id:number;ease:number;result_json:string}|null
    if (prior) {
      if (prior.card_id !== cardId || prior.ease !== ease) throw new Error('Answer request ID was reused for a different grade.')
      return JSON.parse(prior.result_json)
    }
  }
  const row = store.query(`SELECT c.*,n.model_name,n.fields_json FROM cards c JOIN notes n ON n.id=c.note_id WHERE c.id=?`).get(cardId) as CardRow|null
  if (!row || row.queue < 0 || (row.queue !== 0 && row.due_at > Date.now()+1000)) return { saved:false, stale:true as const, cardId, ease }
  const config = getOwnedSettings(row.deck_name)
  const scheduler = fsrs({ request_retention: config.desiredRetention, maximum_interval: config.maximumInterval,
    learning_steps: config.learningSteps, relearning_steps: config.relearningSteps,
    ...(config.fsrsWeights?.length ? { w: config.fsrsWeights } : {}) })
  const now = new Date()
  const next = scheduler.next(fsrsCard(row), now, ease === 1 ? Rating.Again : Rating.Good)
  const nextType = next.card.state === State.New ? 0 : next.card.state === State.Learning ? 1 : next.card.state === State.Relearning ? 3 : 2
  const nextQueue = nextType
  const leech = next.card.lapses >= config.leechThreshold ? 1 : row.leech
  const result = { saved:true, cardId, ease }
  store.transaction(() => {
    store.query(`UPDATE cards SET interval=?,type=?,queue=?,due_at=?,reps=?,lapses=?,stability=?,difficulty=?,scheduled_days=?,learning_steps=?,last_review=?,buried_until=NULL,leech=? WHERE id=?`).run(
      next.card.scheduled_days, nextType, nextQueue, next.card.due.getTime(), next.card.reps, next.card.lapses,
      next.card.stability, next.card.difficulty, next.card.scheduled_days, next.card.learning_steps, now.getTime(), leech, cardId)
    if (config.burySiblings) {
      const tomorrow = new Date(now); tomorrow.setHours(0,0,0,0); tomorrow.setDate(tomorrow.getDate()+1)
      store.query('UPDATE cards SET buried_until=? WHERE note_id=? AND id<>? AND queue>=0').run(tomorrow.getTime(),row.note_id,cardId)
    }
    store.query('INSERT INTO revlog(id,card_id,ease,interval,last_interval,time_ms,kind) VALUES(?,?,?,?,?,?,?)').run(
      Math.max(now.getTime(),Number((store.query('SELECT COALESCE(MAX(id),0) id FROM revlog').get() as {id:number}).id)+1), cardId, ease, next.card.scheduled_days, row.interval, 0, row.type)
    const newIntroduced = row.queue===0 ? 1 : 0
    const reviewCompleted = row.type===2 ? 1 : 0
    store.query(`INSERT INTO daily_activity(day,deck_name,new_introduced,reviews_completed) VALUES(?,?,?,?)
      ON CONFLICT(day,deck_name) DO UPDATE SET new_introduced=new_introduced+excluded.new_introduced,reviews_completed=reviews_completed+excluded.reviews_completed`).run(dayKey(now),row.deck_name,newIntroduced,reviewCompleted)
    if (requestId) store.query('INSERT INTO answer_requests VALUES(?,?,?,?)').run(requestId,cardId,ease,JSON.stringify(result))
    store.query(`DELETE FROM answer_requests WHERE rowid IN (
      SELECT rowid FROM answer_requests ORDER BY rowid DESC LIMIT -1 OFFSET 10000
    )`).run()
  })()
  return result
}

export function ownedMedia(filename: string) {
  if (!filename || filename.includes('/') || filename.includes('\\')) throw new Error('Invalid media filename.')
  const row = db().query('SELECT bytes FROM media WHERE name=?').get(filename) as {bytes:Uint8Array}|null
  return row?.bytes ?? null
}
