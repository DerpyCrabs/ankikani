export type Direction = 'forward' | 'reverse'
export type AnswerLanguage = 'german' | 'english' | 'plain'
export type AnswerMode = 'parts' | 'alternatives' | 'unordered'
export type StudyContentKind = 'text' | 'cloze' | 'audio' | 'image' | 'multi'

export interface SchedulingSettings {
  neuralReviewOrder?: boolean
  rwkvAvailable?: boolean
  newPerDay: number
  reviewsPerDay: number
  desiredRetention: number
  maximumInterval: number
  learningSteps: `${number}${'m' | 'h' | 'd'}`[]
  relearningSteps: `${number}${'m' | 'h' | 'd'}`[]
  leechThreshold: number
  burySiblings: boolean
  fsrsWeights?: number[]
}

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

export interface CardPlan {
  wakaPrompt?: string
  promptChoices?: string[]
  ord: number
  kind: StudyContentKind
  direction: Direction
  directionLabel: string
  promptField?: string
  promptLanguage?: AnswerLanguage
  answerFields: string[]
  answerLabels?: string[]
  answerLanguages: AnswerLanguage[]
  answerMode?: AnswerMode
  answerSeparators?: string[]
  optionalAnswerFields?: string[]
  contextFields?: string[]
  sourceExampleField?: string
  targetExampleField?: string
  noteField?: string
  audioField?: string
  audioFields?: string[]
  promptAudio?: boolean
  imageField?: string
  answerImageField?: string
  clozeField?: string
}

export interface ModelConfig {
  modelName: string
  enabled: boolean
  kind: StudyContentKind
  label: string
  confidence: number
  plans: CardPlan[]
}

export interface DeckConfig {
  version: 2
  deckName: string
  includeSubdecks: true
  customized?: boolean
  models: ModelConfig[]
}

export type StudyConfig = FieldMapping | DeckConfig

export interface ModelCompatibility {
  modelName: string
  status: 'ready' | 'review' | 'unsupported'
  kind: StudyContentKind
  label: string
  confidence: number
  noteCount: number
  reason: string
  previewPrompt: string
  previewAnswer: string
  diagnostics: {
    fields: string[]
    templates: string[]
    promptFields: string[]
    answerFields: string[]
    mediaFields: string[]
    issues: string[]
  }
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
  subdeckCount?: number
}

export interface AnswerPart {
  id: string
  label: string
  canonicalAnswer: string
  acceptedAnswers: string[]
  language: AnswerLanguage
  required?: boolean
  mode?: 'single' | 'unordered'
  separators?: string[]
  items?: Array<{
    canonicalAnswer: string
    acceptedAnswers: string[]
  }>
}

export interface StudyDetail {
  label: string
  value: string
}

export interface StudyCard {
  wakaGlyph?: string
  exerciseChoices?: string[][]
  exerciseInstruction?: string
  promptContext?: string
  promptLabel?: string
  selfGrade?: boolean
  chessDiagram?: { ranks: string[]; turn: string }
  cardId: number
  noteId: number
  modelName: string
  direction: Direction
  directionLabel: string
  prompt: string
  promptLanguage?: AnswerLanguage
  canonicalAnswer: string
  answerLanguage?: AnswerLanguage
  acceptedAnswers: string[]
  answerParts?: AnswerPart[]
  contentKind?: StudyContentKind
  promptAudioFilename?: string | null
  promptAudioFilenames?: string[]
  promptImageFilenames?: string[]
  answerImageFilenames?: string[]
  details?: StudyDetail[]
  practiceOnly?: boolean
  sourceWord: string
  targetMeaning: string
  sourceExample: string
  targetExample: string
  note: string
  audioFilename: string | null
  audioFilenames?: string[]
  interval: number
  type: number
  queue: number
  due: number
  reps: number
  lapses: number
  leech?: boolean
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
  contentKind?: StudyContentKind
  promptAudioFilename?: string | null
  promptAudioFilenames?: string[]
  audioFilenames?: string[]
  imageFilenames?: string[]
  details?: StudyDetail[]
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
  segments: Record<string, number>
}

export interface SpreadLegendItem {
  key: string
  label: string
}

export interface DashboardData {
  deckName: string
  nextLessonSize?: number
  nextReviewAt?: string | null
  firstLesson?: boolean
  lessonsAvailable: number
  reviewsDue: number
  learning: number
  completedToday: number
  completedYesterday: number
  currentStreak: number
  bestStreak: number
  dueToday: number
  forecast: ForecastDay[]
  activeSpread: ActiveStage[]
  spreadLegend: SpreadLegendItem[]
  totalCards: number
  updatedAt: string
}

export interface DeckProfile {
  deckName: string
  modelNames: string[]
  fieldsByModel: Record<string, string[]>
  templatesByModel: Record<string, Record<string, { Front: string; Back: string }>>
  suggestedMapping: FieldMapping | null
  suggestedConfig?: DeckConfig
  compatibility?: ModelCompatibility[]
  samplesByModel?: Record<string, AnkiCardInfo[]>
  schemaFingerprint?: string
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
