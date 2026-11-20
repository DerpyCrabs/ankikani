import { Effect } from 'effect'
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
import { adaptCard, buildDeckConfig, normalizeConfig } from '../src/lib/adapters'
import { activeSpread, buildStudyQueue, calculateStreak } from '../src/lib/study'
import { deckSchemaFingerprint } from '../src/lib/storage'
import { invokeEffect, multiEffect } from './anki'

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

const deckStats = Effect.fn('deckStats')(function* (deckName: string): Effect.fn.Return<DeckStats, Error> {
  const result = yield* invokeEffect<Record<string, DeckStats>>('getDeckStats', {
    decks: [deckName],
  })
  const stats = Object.values(result)[0]
  if (!stats) return yield* Effect.fail(new Error(`Deck not found: ${deckName}`))
  return stats
})

const cardsInfo = Effect.fn('cardsInfo')(function* (
  cardIds: number[],
): Effect.fn.Return<AnkiCardInfo[], Error> {
  if (!cardIds.length) return []
  const cards: AnkiCardInfo[] = []
  for (let offset = 0; offset < cardIds.length; offset += 500) {
    cards.push(
      ...(yield* invokeEffect<AnkiCardInfo[]>('cardsInfo', {
        cards: cardIds.slice(offset, offset + 500),
      })),
    )
  }
  return cards
})

const mappedCards = Effect.fn('mappedCards')(function* (
  cardIds: number[],
  deckName: string,
  configuration: StudyConfig,
) {
  const config = normalizeConfig(deckName, configuration)
  return (yield* cardsInfo(cardIds))
    .map((card) => adaptCard(card, config))
    .filter((card): card is StudyCard => Boolean(card))
})

export const listDecks = Effect.fn('listDecks')(function* (): Effect.fn.Return<DeckSummary[], Error> {
  const decks = yield* invokeEffect<Record<string, number>>('deckNamesAndIds')
  const entries = Object.entries(decks)
  return entries
    .filter(([name]) => !name.includes('::'))
    .map(([name, id]) => ({
      id,
      name,
      supported: true,
      modelNames: [],
      subdeckCount: entries.filter(([candidate]) => candidate.startsWith(`${name}::`)).length,
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name))
})

export const getDeckProfile = Effect.fn('getDeckProfile')(function* (
  deckName: string,
): Effect.fn.Return<DeckProfile, Error> {
  const allModelNames = yield* invokeEffect<string[]>('modelNames')
  const matches = yield* multiEffect<number[][]>(
    allModelNames.map((modelName) => ({
      action: 'findNotes',
      params: {
        query: `${quotedDeck(deckName)} note:"${modelName.replaceAll('"', '\\"')}"`,
      },
    })),
  )
  const noteIdsByModel = new Map(allModelNames.map((modelName, index) => [modelName, matches[index] ?? []]))
  const modelNames = allModelNames.filter((modelName) => noteIdsByModel.get(modelName)?.length)
  const modelDetails = yield* multiEffect<Array<string[] | Record<string, { Front: string; Back: string }>>>(
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
  const sampleIds = yield* multiEffect<number[][]>(
    modelNames.map((modelName) => ({
      action: 'findCards',
      params: {
        query: `${quotedDeck(deckName)} note:"${modelName.replaceAll('"', '\\"')}"`,
      },
    })),
  )
  const samplesByModel: DeckProfile['samplesByModel'] = {}
  yield* Effect.forEach(modelNames, (modelName, index) =>
    Effect.gen(function* () {
      const candidates = yield* cardsInfo((sampleIds[index] ?? []).slice(0, 40))
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
    suggestedMapping: modelNames.includes(GOETHE_MAPPING.modelName) ? GOETHE_MAPPING : null,
    suggestedConfig: detected.config,
    compatibility: detected.compatibility,
    samplesByModel,
  } satisfies DeckProfile
  return {
    ...profile,
    schemaFingerprint: deckSchemaFingerprint(profile),
  }
})

function dayDescriptor(offset: number) {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + offset)
  const iso = [
    date.getFullYear(),
    `${date.getMonth() + 1}`.padStart(2, '0'),
    `${date.getDate()}`.padStart(2, '0'),
  ].join('-')
  const label = offset === 0 ? 'Today' : date.toLocaleDateString(undefined, { weekday: 'short' })
  return { date: iso, label }
}

const forecast = Effect.fn('forecast')(function* (deckName: string): Effect.fn.Return<ForecastDay[], Error> {
  const query = quotedDeck(deckName)
  const ids = yield* multiEffect<number[][]>(
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
})

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

export const getDashboard = Effect.fn('getDashboard')(function* (
  deckName: string,
  configuration: StudyConfig,
): Effect.fn.Return<DashboardData, Error> {
  const deckQuery = quotedDeck(deckName)
  const [stats, allCardIds, reviewLog, week, dueIds] = yield* Effect.all([
    deckStats(deckName),
    invokeEffect<number[]>('findCards', { query: deckQuery }),
    invokeEffect<ReviewLog[]>('cardReviews', { deck: deckName, startID: 0 }),
    forecast(deckName),
    multiEffect<[number[], number[]]>([
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
  const allCards = yield* mappedCards(allCardIds, deckName, configuration)
  const enabledCardIds = new Set(allCards.map((card) => card.cardId))
  const visibleWeek = week.map((day) => {
    const cardIds = day.cardIds.filter((cardId) => enabledCardIds.has(cardId))
    return { ...day, cardIds, count: cardIds.length }
  })
  const learningDue = dueIds[0]
    .slice(0, stats.learn_count)
    .filter((cardId) => enabledCardIds.has(cardId)).length
  const reviewsDue = dueIds[1]
    .slice(0, stats.review_count)
    .filter((cardId) => enabledCardIds.has(cardId)).length
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const streak = calculateStreak(
    reviewLog.filter((review) => reviewEase(review) > 0).map((review) => reviewId(review)),
    now,
  )
  const newNoteIds = new Set(
    allCards.filter((card) => card.type === 0 && card.queue === 0).map((card) => card.noteId),
  )
  const spread = activeSpread(allCards)

  return {
    deckName,
    lessonsAvailable: Math.min(newNoteIds.size, stats.new_count),
    reviewsDue: reviewsDue + learningDue,
    learning: learningDue,
    completedToday: reviewedOn(reviewLog, now),
    completedYesterday: reviewedOn(reviewLog, yesterday),
    currentStreak: streak.current,
    bestStreak: streak.best,
    dueToday: visibleWeek[0]?.count ?? 0,
    forecast: visibleWeek,
    activeSpread: spread.stages,
    spreadLegend: spread.legend,
    totalCards: allCards.length,
    updatedAt: new Date().toISOString(),
  }
})

export const getReviewSession = Effect.fn('getReviewSession')(function* (
  deckName: string,
  configuration: StudyConfig,
): Effect.fn.Return<SessionPayload, Error> {
  const stats = yield* deckStats(deckName)
  const deckQuery = quotedDeck(deckName)
  const [learningIds, reviewIds] = yield* multiEffect<[number[], number[]]>([
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
  const selectedIds = [...learningIds.slice(0, stats.learn_count), ...reviewIds.slice(0, stats.review_count)]
  return {
    deckName,
    cards: buildStudyQueue(yield* mappedCards(selectedIds, deckName, configuration)),
  }
})

export const getLessonSession = Effect.fn('getLessonSession')(function* (
  deckName: string,
  configuration: StudyConfig,
): Effect.fn.Return<LessonPayload, Error> {
  const stats = yield* deckStats(deckName)
  if (stats.new_count <= 0) return { deckName, items: [], quizCards: [] }

  const newIds = yield* invokeEffect<number[]>('findCards', {
    query: `${quotedDeck(deckName)} is:new -is:suspended -is:buried`,
  })
  const candidates = yield* mappedCards(newIds, deckName, configuration)
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
})

export const getCards = Effect.fn('getCards')(function* (
  cardIds: number[],
  deckName: string,
  configuration: StudyConfig,
): Effect.fn.Return<StudyCard[], Error> {
  return yield* mappedCards(cardIds, deckName, configuration)
})

type GradeResult = { saved: boolean; stale?: true; cardId: number; ease: 1 | 3 }
type GradeRequest = { cardId: number; ease: 1 | 3; result: Effect.Effect<GradeResult, Error> }

const pendingGrades = new Map<string, GradeRequest>()
const savedGrades = new Map<string, GradeRequest>()

export const answerCard = Effect.fn('answerCard')(function* (cardId: number, ease: 1 | 3, requestId?: string) {
  const write = invokeEffect<boolean[]>('answerCards', { answers: [{ cardId, ease }] }).pipe(
    Effect.map(([accepted]): GradeResult => accepted
      ? { saved: true, cardId, ease }
      : { saved: false, stale: true, cardId, ease }),
  )
  if (!requestId) return yield* write
  const prior = pendingGrades.get(requestId) ?? savedGrades.get(requestId)
  if (prior) {
    if (prior.cardId !== cardId || prior.ease !== ease) {
      return yield* Effect.fail(new Error('Answer request ID was reused for a different grade.'))
    }
    return yield* prior.result
  }
  const result = yield* Effect.cached(write.pipe(
    Effect.tap(grade => Effect.sync(() => {
      savedGrades.set(requestId, { cardId, ease, result: Effect.succeed(grade) })
      if (savedGrades.size > 2_000) savedGrades.delete(savedGrades.keys().next().value!)
    })),
    Effect.ensuring(Effect.sync(() => pendingGrades.delete(requestId))),
  ))
  pendingGrades.set(requestId, { cardId, ease, result })
  return yield* result
})

export const mediaFile = Effect.fn('mediaFile')(function* (filename: string) {
  if (!filename || filename.includes('/') || filename.includes('\\')) {
    throw new Error('Invalid media filename.')
  }
  const data = yield* invokeEffect<string | false>('retrieveMediaFile', { filename })
  if (!data) return null
  return Uint8Array.from(atob(data), (character) => character.charCodeAt(0))
})
