import type {
  AnkiCardInfo,
  DashboardData,
  DeckProfile,
  DeckSummary,
  FieldMapping,
  ForecastDay,
  LessonItem,
  LessonPayload,
  SessionPayload,
  StudyCard,
} from '../src/lib/domain'
import {
  activeSpread,
  buildStudyQueue,
  calculateStreak,
  toStudyCard,
} from '../src/lib/study'
import { ankiInvoke, ankiMulti } from './anki'

interface DeckStats {
  deck_id: number
  name: string
  new_count: number
  learn_count: number
  review_count: number
  total_in_deck: number
}

interface ReviewLogObject {
  id: number
  cid: number
  ease: number
  ivl: number
  lastIvl: number
  factor: number
  time: number
  type: number
}

type ReviewLogTuple = [
  id: number,
  cid: number,
  usn: number,
  ease: number,
  ivl: number,
  lastIvl: number,
  factor: number,
  time: number,
  type: number,
]

type ReviewLog = ReviewLogObject | ReviewLogTuple

export const GOETHE_MAPPING: FieldMapping = {
  modelName: 'Goethe Vocab List',
  sourceWord: 'de_word',
  targetMeaning: 'en_word',
  sourceExample: 'de_sentence',
  targetExample: 'en_sentence',
  note: 'en_note',
  audio: 'de_audio',
  forwardOrd: 0,
  reverseOrd: 1,
  sourceLabel: 'German',
  targetLabel: 'English',
}

function quotedDeck(deckName: string): string {
  return `deck:"${deckName.replaceAll('"', '\\"')}"`
}

async function deckStats(deckName: string): Promise<DeckStats> {
  const result = await ankiInvoke<Record<string, DeckStats>>('getDeckStats', {
    decks: [deckName],
  })
  const stats = Object.values(result)[0]
  if (!stats) throw new Error(`Deck not found: ${deckName}`)
  return stats
}

async function cardsInfo(cardIds: number[]): Promise<AnkiCardInfo[]> {
  if (!cardIds.length) return []
  return ankiInvoke<AnkiCardInfo[]>('cardsInfo', { cards: cardIds })
}

async function mappedCards(cardIds: number[], mapping: FieldMapping) {
  return (await cardsInfo(cardIds))
    .filter((card) => card.cardId && card.modelName === mapping.modelName)
    .map((card) => toStudyCard(card, mapping))
}

export async function listDecks(): Promise<DeckSummary[]> {
  const decks = await ankiInvoke<Record<string, number>>('deckNamesAndIds')
  return Object.entries(decks)
    .filter(([name]) => !name.includes('::'))
    .map(([name, id]) => ({
      id,
      name,
      supported: name === 'Goethe Institute A1 Wordlist',
      modelNames: name === 'Goethe Institute A1 Wordlist' ? ['Goethe Vocab List'] : [],
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name))
}

export async function getDeckProfile(deckName: string): Promise<DeckProfile> {
  const allModelNames = await ankiInvoke<string[]>('modelNames')
  const matches = await ankiMulti<number[][]>(
    allModelNames.map((modelName) => ({
      action: 'findNotes',
      params: {
        query: `${quotedDeck(deckName)} note:"${modelName.replaceAll('"', '\\"')}"`,
      },
    })),
  )
  const modelNames = allModelNames.filter((_, index) => matches[index]?.length)
  const modelDetails = await ankiMulti<
    Array<string[] | Record<string, { Front: string; Back: string }>>
  >(
    modelNames.flatMap((modelName) => [
      { action: 'modelFieldNames', params: { modelName } },
      { action: 'modelTemplates', params: { modelName } },
    ]),
  )
  const fieldsByModel: Record<string, string[]> = {}
  const templatesByModel: DeckProfile['templatesByModel'] = {}

  modelNames.forEach((modelName, index) => {
    fieldsByModel[modelName] = modelDetails[index * 2] as string[]
    templatesByModel[modelName] = modelDetails[index * 2 + 1] as Record<
      string,
      { Front: string; Back: string }
    >
  })

  return {
    deckName,
    modelNames,
    fieldsByModel,
    templatesByModel,
    suggestedMapping: modelNames.includes(GOETHE_MAPPING.modelName)
      ? GOETHE_MAPPING
      : null,
  }
}

function dayDescriptor(offset: number) {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + offset)
  const iso = [
    date.getFullYear(),
    `${date.getMonth() + 1}`.padStart(2, '0'),
    `${date.getDate()}`.padStart(2, '0'),
  ].join('-')
  const label =
    offset === 0
      ? 'Today'
      : date.toLocaleDateString(undefined, { weekday: 'short' })
  return { date: iso, label }
}

async function forecast(deckName: string): Promise<ForecastDay[]> {
  const query = quotedDeck(deckName)
  const ids = await ankiMulti<number[][]>(
    Array.from({ length: 7 }, (_, offset) => ({
      action: 'findCards',
      params: { query: `${query} prop:due=${offset} -is:suspended -is:buried` },
    })),
  )
  return ids.map((cardIds, offset) => ({
    ...dayDescriptor(offset),
    count: cardIds.length,
    cardIds,
  }))
}

function reviewedOn(log: ReviewLog[], date: Date): number {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return log.filter((review) => {
    const id = reviewId(review)
    return reviewEase(review) > 0 && id >= start.getTime() && id < end.getTime()
  }).length
}

function reviewId(review: ReviewLog): number {
  return Array.isArray(review) ? review[0] : review.id
}

function reviewEase(review: ReviewLog): number {
  return Array.isArray(review) ? review[3] : review.ease
}

export async function getDashboard(
  deckName: string,
  mapping: FieldMapping,
): Promise<DashboardData> {
  const deckQuery = quotedDeck(deckName)
  const [stats, allCardIds, reviewLog, week] = await Promise.all([
    deckStats(deckName),
    ankiInvoke<number[]>('findCards', { query: deckQuery }),
    ankiInvoke<ReviewLog[]>('cardReviews', { deck: deckName, startID: 0 }),
    forecast(deckName),
  ])
  const allCards = await mappedCards(allCardIds, mapping)
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const streak = calculateStreak(
    reviewLog
      .filter((review) => reviewEase(review) > 0)
      .map((review) => reviewId(review)),
    now,
  )
  const newNoteIds = new Set(
    allCards.filter((card) => card.type === 0 && card.queue === 0).map((card) => card.noteId),
  )

  return {
    deckName,
    lessonsAvailable: Math.min(
      newNoteIds.size,
      Math.floor(stats.new_count / 2),
    ),
    reviewsDue: stats.review_count + stats.learn_count,
    learning: stats.learn_count,
    completedToday: reviewedOn(reviewLog, now),
    completedYesterday: reviewedOn(reviewLog, yesterday),
    currentStreak: streak.current,
    bestStreak: streak.best,
    next24Hours: week[0]?.count ?? 0,
    forecast: week,
    activeSpread: activeSpread(allCards),
    totalCards: stats.total_in_deck,
    updatedAt: new Date().toISOString(),
  }
}

export async function getReviewSession(
  deckName: string,
  mapping: FieldMapping,
): Promise<SessionPayload> {
  const stats = await deckStats(deckName)
  const deckQuery = quotedDeck(deckName)
  const [learningIds, reviewIds] = await ankiMulti<[number[], number[]]>([
    {
      action: 'findCards',
      params: {
        query: `${deckQuery} is:learn -is:suspended -is:buried`,
      },
    },
    {
      action: 'findCards',
      params: {
        query: `${deckQuery} is:due -is:new -is:learn -is:suspended -is:buried`,
      },
    },
  ])
  const selectedIds = [
    ...learningIds.slice(0, stats.learn_count),
    ...reviewIds.slice(0, stats.review_count),
  ]
  return {
    deckName,
    cards: buildStudyQueue(await mappedCards(selectedIds, mapping)),
  }
}

export async function getLessonSession(
  deckName: string,
  mapping: FieldMapping,
): Promise<LessonPayload> {
  const stats = await deckStats(deckName)
  const capacity = Math.min(5, Math.floor(stats.new_count / 2))
  if (capacity <= 0) return { deckName, items: [], quizCards: [] }

  const newIds = await ankiInvoke<number[]>('findCards', {
    query: `${quotedDeck(deckName)} is:new -is:suspended -is:buried`,
  })
  const candidates = await mappedCards(
    newIds.slice(0, Math.max(50, stats.new_count * 3)),
    mapping,
  )
  const grouped = new Map<number, StudyCard[]>()
  for (const card of candidates) {
    const group = grouped.get(card.noteId) ?? []
    group.push(card)
    grouped.set(card.noteId, group)
  }

  const completePairs = [...grouped.values()]
    .filter(
      (cards) =>
        cards.some((card) => card.direction === 'forward') &&
        cards.some((card) => card.direction === 'reverse'),
    )
    .slice(0, capacity)

  const items: LessonItem[] = completePairs.map((cards) => {
    const card = cards[0]
    return {
      noteId: card.noteId,
      sourceWord: card.sourceWord,
      targetMeaning: card.targetMeaning,
      sourceExample: card.sourceExample,
      targetExample: card.targetExample,
      note: card.note,
      audioFilename: card.audioFilename,
      cards,
    }
  })

  return {
    deckName,
    items,
    quizCards: buildStudyQueue(items.flatMap((item) => item.cards)),
  }
}

export async function getCards(
  cardIds: number[],
  mapping: FieldMapping,
): Promise<StudyCard[]> {
  return mappedCards(cardIds, mapping)
}

export async function answerCard(cardId: number, ease: 1 | 3) {
  const result = await ankiInvoke<boolean[]>('answerCards', {
    answers: [{ cardId, ease }],
  })
  if (!result[0]) throw new Error('Anki did not accept the card grade.')
  return { saved: true, cardId, ease }
}

export async function mediaFile(filename: string) {
  if (!filename || filename.includes('/') || filename.includes('\\')) {
    throw new Error('Invalid media filename.')
  }
  const data = await ankiInvoke<string | false>('retrieveMediaFile', { filename })
  if (!data) return null
  return Uint8Array.from(atob(data), (character) => character.charCodeAt(0))
}
