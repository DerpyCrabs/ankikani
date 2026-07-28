export type Direction = 'forward' | 'reverse'

export interface FieldMapping {
  modelName: string
  sourceWord: string
  targetMeaning: string
  sourceExample?: string
  targetExample?: string
  note?: string
  audio?: string
  forwardOrd: number
  reverseOrd: number
  sourceLabel: string
  targetLabel: string
}

export interface AnkiField {
  value: string
  order: number
}

export interface AnkiCardInfo {
  cardId: number
  fields: Record<string, AnkiField>
  fieldOrder: number
  question: string
  answer: string
  modelName: string
  ord: number
  deckName: string
  interval: number
  note: number
  type: number
  queue: number
  due: number
  reps: number
  lapses: number
  left: number
  mod: number
  flags: number
}

export interface DeckSummary {
  id: number
  name: string
  supported: boolean
  modelNames: string[]
}

export interface StudyCard {
  cardId: number
  noteId: number
  modelName: string
  direction: Direction
  directionLabel: string
  prompt: string
  canonicalAnswer: string
  acceptedAnswers: string[]
  sourceWord: string
  targetMeaning: string
  sourceExample: string
  targetExample: string
  note: string
  audioFilename: string | null
  interval: number
  type: number
  queue: number
  due: number
  reps: number
  lapses: number
}

export interface LessonItem {
  noteId: number
  sourceWord: string
  targetMeaning: string
  sourceExample: string
  targetExample: string
  note: string
  audioFilename: string | null
  cards: StudyCard[]
}

export interface ForecastDay {
  date: string
  label: string
  count: number
  cardIds: number[]
}

export interface ActiveStage {
  key: string
  label: string
  total: number
  forwardWeak: number
  reverseWeak: number
  balanced: number
}

export interface DashboardData {
  deckName: string
  lessonsAvailable: number
  reviewsDue: number
  learning: number
  completedToday: number
  completedYesterday: number
  currentStreak: number
  bestStreak: number
  next24Hours: number
  forecast: ForecastDay[]
  activeSpread: ActiveStage[]
  totalCards: number
  updatedAt: string
}

export interface DeckProfile {
  deckName: string
  modelNames: string[]
  fieldsByModel: Record<string, string[]>
  templatesByModel: Record<string, Record<string, { Front: string; Back: string }>>
  suggestedMapping: FieldMapping | null
}

export interface SessionPayload {
  deckName: string
  cards: StudyCard[]
}

export interface LessonPayload {
  deckName: string
  items: LessonItem[]
  quizCards: StudyCard[]
}

export interface AnswerResult {
  correct: boolean
  canonicalAnswer: string
  acceptedAnswers: string[]
}
