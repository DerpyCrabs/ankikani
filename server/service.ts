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
  StudyConfig,
  StudyCard,
} from '../src/lib/domain'
import {
  adaptCard,
  buildDeckConfig,
  normalizeConfig,
} from '../src/lib/adapters'
import {
  activeSpread,
  buildStudyQueue,
  calculateStreak,
} from '../src/lib/study'
import { deckSchemaFingerprint } from '../src/lib/storage'
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

async function mappedCards(
  cardIds: number[],
  deckName: string,
  configuration: StudyConfig,
) {
  const config = normalizeConfig(deckName, configuration)
  return (await cardsInfo(cardIds))
    .map((card) => adaptCard(card, config))
    .filter((card): card is StudyCard => Boolean(card))
}

export async function listDecks(): Promise<DeckSummary[]> {
  const decks = await ankiInvoke<Record<string, number>>('deckNamesAndIds')
  const entries = Object.entries(decks)
  return entries
    .filter(([name]) => !name.includes('::'))
    .map(([name, id]) => ({
      id,
      name,
      supported: true,
      modelNames: [],
      subdeckCount: entries.filter(([candidate]) =>
        candidate.startsWith(`${name}::`),
      ).length,
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
  const noteIdsByModel = new Map(
    allModelNames.map((modelName, index) => [modelName, matches[index] ?? []]),
  )
  const modelNames = allModelNames.filter(
    (modelName) => noteIdsByModel.get(modelName)?.length,
  )
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
  const sampleIds = await ankiMulti<number[][]>(
    modelNames.map((modelName) => ({
      action: 'findCards',
      params: {
        query: `${quotedDeck(deckName)} note:"${modelName.replaceAll('"', '\\"')}"`,
      },
    })),
  )
  const samplesByModel: DeckProfile['samplesByModel'] = {}
  await Promise.all(
    modelNames.map(async (modelName, index) => {
      const candidates = await cardsInfo((sampleIds[index] ?? []).slice(0, 40))
      const notes = new Set<number>()
      samplesByModel[modelName] = candidates.filter((card) => {
        if (notes.has(card.note) || notes.size >= 8) return false
        notes.add(card.note)
        return true
      })
    }),
  )
  const detected = buildDeckConfig(
    deckName,
    modelNames.map((modelName) => ({
      modelName,
      fields: fieldsByModel[modelName] ?? [],
      templateCount: Object.keys(templatesByModel[modelName] ?? {}).length,
      templates: templatesByModel[modelName] ?? {},
      noteCount: noteIdsByModel.get(modelName)?.length ?? 0,
      samples: samplesByModel[modelName] ?? [],
    })),
  )

  const profile = {
    deckName,
    modelNames,
    fieldsByModel,
    templatesByModel,
    suggestedMapping: modelNames.includes(GOETHE_MAPPING.modelName)
      ? GOETHE_MAPPING
      : null,
    suggestedConfig: detected.config,
    compatibility: detected.compatibility,
    samplesByModel,
  } satisfies DeckProfile
  return {
    ...profile,
    schemaFingerprint: deckSchemaFingerprint(profile),
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
  configuration: StudyConfig,
): Promise<DashboardData> {
  const deckQuery = quotedDeck(deckName)
  const [stats, allCardIds, reviewLog, week, dueIds] = await Promise.all([
    deckStats(deckName),
    ankiInvoke<number[]>('findCards', { query: deckQuery }),
    ankiInvoke<ReviewLog[]>('cardReviews', { deck: deckName, startID: 0 }),
    forecast(deckName),
    ankiMulti<[number[], number[]]>([
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
    ]),
  ])
  const allCards = await mappedCards(allCardIds, deckName, configuration)
  const enabledCardIds = new Set(allCards.map((card) => card.cardId))
  const visibleWeek = week.map((day) => {
    const cardIds = day.cardIds.filter((cardId) => enabledCardIds.has(cardId))
    return { ...day, cardIds, count: cardIds.length }
  })
  const learningDue = dueIds[0]
    .slice(0, stats.learn_count)
    .filter((cardId) => enabledCardIds.has(cardId))
    .length
  const reviewsDue = dueIds[1]
    .slice(0, stats.review_count)
    .filter((cardId) => enabledCardIds.has(cardId))
    .length
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
  const spread = activeSpread(allCards)

  return {
    deckName,
    lessonsAvailable: Math.min(
      newNoteIds.size,
      stats.new_count,
    ),
    reviewsDue: reviewsDue + learningDue,
    learning: learningDue,
    completedToday: reviewedOn(reviewLog, now),
    completedYesterday: reviewedOn(reviewLog, yesterday),
    currentStreak: streak.current,
    bestStreak: streak.best,
    next24Hours: visibleWeek[0]?.count ?? 0,
    forecast: visibleWeek,
    activeSpread: spread.stages,
    spreadLegend: spread.legend,
    totalCards: allCards.length,
    updatedAt: new Date().toISOString(),
  }
}

export async function getReviewSession(
  deckName: string,
  configuration: StudyConfig,
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
    cards: buildStudyQueue(
      await mappedCards(selectedIds, deckName, configuration),
    ),
  }
}

export async function getLessonSession(
  deckName: string,
  configuration: StudyConfig,
): Promise<LessonPayload> {
  const stats = await deckStats(deckName)
  if (stats.new_count <= 0) return { deckName, items: [], quizCards: [] }

  const newIds = await ankiInvoke<number[]>('findCards', {
    query: `${quotedDeck(deckName)} is:new -is:suspended -is:buried`,
  })
  const candidates = await mappedCards(
    newIds.slice(0, Math.max(200, stats.new_count * 10)),
    deckName,
    configuration,
  )
  const grouped = new Map<number, StudyCard[]>()
  for (const card of candidates) {
    const group = grouped.get(card.noteId) ?? []
    group.push(card)
    grouped.set(card.noteId, group)
  }

  const groupsByModel = new Map<string, StudyCard[][]>()
  for (const cards of grouped.values()) {
    const available = cards.filter((card) => card.type === 0 && card.queue === 0)
    if (!available.length) continue
    const queue = groupsByModel.get(available[0].modelName) ?? []
    queue.push(available)
    groupsByModel.set(available[0].modelName, queue)
  }

  const selectedGroups: StudyCard[][] = []
  let selectedCardCount = 0
  while (selectedGroups.length < 5 && groupsByModel.size) {
    let selectedThisPass = false
    for (const [modelName, queue] of groupsByModel) {
      const available = queue.shift()
      if (!queue.length) groupsByModel.delete(modelName)
      if (!available) continue
      if (selectedCardCount + available.length <= stats.new_count) {
        selectedGroups.push(available)
        selectedCardCount += available.length
        selectedThisPass = true
      }
      if (selectedGroups.length >= 5) break
    }
    if (!selectedThisPass) break
  }

  const items: LessonItem[] = selectedGroups.map((cards) => {
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
      contentKind: card.contentKind,
      promptAudioFilename: card.promptAudioFilename,
      promptAudioFilenames: card.promptAudioFilenames,
      audioFilenames: card.audioFilenames,
      imageFilenames: card.promptImageFilenames,
      details: card.details,
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
  deckName: string,
  configuration: StudyConfig,
): Promise<StudyCard[]> {
  return mappedCards(cardIds, deckName, configuration)
}

const answerRequests = new Map<
  string,
  {
    cardId: number
    ease: 1 | 3
    result: Promise<{
      saved: boolean
      stale?: true
      cardId: number
      ease: 1 | 3
    }>
  }
>()

export async function answerCard(
  cardId: number,
  ease: 1 | 3,
  requestId?: string,
) {
  if (requestId) {
    const existing = answerRequests.get(requestId)
    if (existing) {
      if (existing.cardId !== cardId || existing.ease !== ease) {
        throw new Error('Answer request ID was reused for a different grade.')
      }
      return existing.result
    }
  }

  const result = (async () => {
    const accepted = await ankiInvoke<boolean[]>('answerCards', {
      answers: [{ cardId, ease }],
    })
    if (!accepted[0]) {
      return { saved: false, stale: true as const, cardId, ease }
    }
    return { saved: true, cardId, ease }
  })()

  if (requestId) {
    answerRequests.set(requestId, { cardId, ease, result })
    if (answerRequests.size > 2_000) {
      const oldest = answerRequests.keys().next().value
      if (oldest) answerRequests.delete(oldest)
    }
  }
  try {
    return await result
  } catch (error) {
    if (requestId) answerRequests.delete(requestId)
    throw error
  }
}

export async function mediaFile(filename: string) {
  if (!filename || filename.includes('/') || filename.includes('\\')) {
    throw new Error('Invalid media filename.')
  }
  const data = await ankiInvoke<string | false>('retrieveMediaFile', { filename })
  if (!data) return null
  return Uint8Array.from(atob(data), (character) => character.charCodeAt(0))
}
