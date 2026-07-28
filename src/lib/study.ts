import type {
  ActiveStage,
  AnkiCardInfo,
  Direction,
  FieldMapping,
  StudyCard,
  SpreadLegendItem,
} from './domain'
import {
  audioFilename,
  englishAnswerVariants,
  germanAnswerVariants,
  stripAudio,
  stripHtml,
} from './answers'

const STAGES = [
  { key: 'learning', label: 'Learning' },
  { key: 'lt1', label: '<1 day' },
  { key: '1-3', label: '1–3 days' },
  { key: '4-7', label: '4–7 days' },
  { key: '8-14', label: '8–14 days' },
  { key: '15-30', label: '15–30 days' },
  { key: '31-90', label: '31–90 days' },
  { key: '90+', label: '90+ days' },
] as const

function field(card: AnkiCardInfo, name?: string): string {
  if (!name) return ''
  return card.fields[name]?.value ?? ''
}

function plain(value: string): string {
  return stripAudio(stripHtml(value)).replace(/\s+/gu, ' ').trim()
}

export function toStudyCard(
  card: AnkiCardInfo,
  mapping: FieldMapping,
): StudyCard {
  const direction: Direction =
    card.ord === mapping.reverseOrd ? 'reverse' : 'forward'
  const sourceWord = plain(field(card, mapping.sourceWord))
  const targetMeaning = plain(field(card, mapping.targetMeaning))
  const answerIsGerman = direction === 'reverse'
  const rawAnswer = answerIsGerman ? sourceWord : targetMeaning
  const acceptedAnswers = answerIsGerman
    ? germanAnswerVariants(rawAnswer)
    : englishAnswerVariants(rawAnswer)

  return {
    cardId: card.cardId,
    noteId: card.note,
    modelName: card.modelName,
    direction,
    directionLabel:
      direction === 'forward'
        ? `${mapping.sourceLabel} → ${mapping.targetLabel}`
        : `${mapping.targetLabel} → ${mapping.sourceLabel}`,
    prompt: direction === 'forward' ? sourceWord : targetMeaning,
    promptLanguage: direction === 'forward' ? 'german' : 'english',
    canonicalAnswer: acceptedAnswers[0] ?? rawAnswer,
    answerLanguage: answerIsGerman ? 'german' : 'english',
    acceptedAnswers,
    sourceWord,
    targetMeaning,
    sourceExample: plain(field(card, mapping.sourceExample)),
    targetExample: plain(field(card, mapping.targetExample)),
    note: plain(field(card, mapping.note)),
    audioFilename: audioFilename(field(card, mapping.audio)),
    interval: card.interval,
    type: card.type,
    queue: card.queue,
    due: card.due,
    reps: card.reps,
    lapses: card.lapses,
  }
}

function queuePriority(card: StudyCard): number {
  if (card.type === 1 || card.type === 3 || card.queue === 1 || card.queue === 3)
    return 0
  if (card.type === 2 || card.queue === 2) return 1
  return 2
}

export function buildStudyQueue(cards: StudyCard[]): StudyCard[] {
  const sorted = cards
    .filter((card) => card.queue >= 0)
    .toSorted(
      (a, b) =>
        queuePriority(a) - queuePriority(b) ||
        a.due - b.due ||
        a.cardId - b.cardId,
    )

  const result: StudyCard[] = []
  const remaining = [...sorted]

  while (remaining.length) {
    const previousNote = result.at(-1)?.noteId
    const nextIndex = remaining.findIndex((card) => card.noteId !== previousNote)
    result.push(...remaining.splice(nextIndex >= 0 ? nextIndex : 0, 1))
  }

  return result
}

export function stageIndex(card: Pick<StudyCard, 'interval' | 'type' | 'queue'>) {
  if (
    card.type === 1 ||
    card.type === 3 ||
    card.queue === 1 ||
    card.queue === 3
  )
    return 0
  if (card.interval < 1) return 1
  if (card.interval <= 3) return 2
  if (card.interval <= 7) return 3
  if (card.interval <= 14) return 4
  if (card.interval <= 30) return 5
  if (card.interval <= 90) return 6
  return 7
}

function contentLabel(card: StudyCard): string {
  if (card.contentKind === 'audio') return 'Listening'
  if (card.contentKind === 'cloze') return 'Cloze'
  if (card.contentKind === 'multi') return 'Multi-part'
  if (card.contentKind === 'image') return 'Image recall'
  return card.directionLabel
}

export function activeSpread(cards: StudyCard[]): {
  stages: ActiveStage[]
  legend: SpreadLegendItem[]
} {
  const stages: ActiveStage[] = STAGES.map((stage) => ({
    ...stage,
    total: 0,
    segments: {},
  }))
  const legend = new Map<string, string>()
  const notes = new Map<number, StudyCard[]>()

  for (const card of cards.filter((item) => item.type !== 0)) {
    const group = notes.get(card.noteId) ?? []
    group.push(card)
    notes.set(card.noteId, group)
  }

  for (const noteCards of notes.values()) {
    const forwardStages = noteCards
      .filter((card) => card.direction === 'forward')
      .map(stageIndex)
    const reverseStages = noteCards
      .filter((card) => card.direction === 'reverse')
      .map(stageIndex)
    const forwardStage = forwardStages.length ? Math.min(...forwardStages) : null
    const reverseStage = reverseStages.length ? Math.min(...reverseStages) : null
    if (forwardStage === null || reverseStage === null) {
      const onlyStage = forwardStage ?? reverseStage
      if (onlyStage === null) continue
      const onlyCard = noteCards[0]
      const label = contentLabel(onlyCard)
      const key = `content:${label}`
      stages[onlyStage].total += 1
      stages[onlyStage].segments[key] =
        (stages[onlyStage].segments[key] ?? 0) + 1
      legend.set(key, label)
      continue
    }
    const weakestStage = Math.min(forwardStage, reverseStage)
    const stage = stages[weakestStage]
    stage.total += 1
    const weaker =
      forwardStage < reverseStage
        ? noteCards.find((card) => card.direction === 'forward')
        : reverseStage < forwardStage
          ? noteCards.find((card) => card.direction === 'reverse')
          : null
    const label = weaker ? `${contentLabel(weaker)} weaker` : 'Balanced'
    const key = weaker ? `weak:${label}` : 'balanced'
    stage.segments[key] = (stage.segments[key] ?? 0) + 1
    legend.set(key, label)
  }

  return {
    stages,
    legend: [...legend].map(([key, label]) => ({ key, label })),
  }
}

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dayKeyOffset(now: Date, offset: number): string {
  const day = new Date(now)
  day.setHours(12, 0, 0, 0)
  day.setDate(day.getDate() + offset)
  return localDateKey(day.getTime())
}

export function calculateStreak(reviewIds: number[], now = new Date()) {
  const activeDays = new Set(reviewIds.map(localDateKey))
  let current = 0
  let cursor = activeDays.has(dayKeyOffset(now, 0)) ? 0 : -1

  while (activeDays.has(dayKeyOffset(now, cursor))) {
    current += 1
    cursor -= 1
  }

  const ordered = [...activeDays].toSorted()
  let best = 0
  let running = 0
  let previous: Date | null = null

  for (const key of ordered) {
    const date = new Date(`${key}T12:00:00`)
    if (
      previous &&
      Math.round((date.getTime() - previous.getTime()) / 86_400_000) === 1
    ) {
      running += 1
    } else {
      running = 1
    }
    best = Math.max(best, running)
    previous = date
  }

  return { current, best, activeDays }
}
