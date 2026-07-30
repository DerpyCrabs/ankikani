import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnkiCardInfo } from '../src/lib/domain'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  multi: vi.fn(),
}))

vi.mock('../server/anki', () => ({
  ankiInvoke: mocks.invoke,
  ankiMulti: mocks.multi,
}))

import {
  GOETHE_MAPPING,
  answerCard,
  getCards,
  getDashboard,
  getLessonSession,
  getReviewSession,
  listDecks,
} from '../server/service'

function ankiCard(
  cardId: number,
  note: number,
  ord: 0 | 1,
  options: Partial<AnkiCardInfo> = {},
): AnkiCardInfo {
  return {
    cardId,
    fields: {
      de_word: { value: `das Wort ${note}`, order: 0 },
      de_sentence: { value: `Das ist Wort ${note}.`, order: 1 },
      en_word: { value: `word ${note}`, order: 2 },
      en_sentence: { value: `This is word ${note}.`, order: 3 },
      en_note: { value: '', order: 4 },
      de_audio: { value: `[sound:${note}.mp3]`, order: 5 },
    },
    fieldOrder: ord,
    question: '',
    answer: '',
    modelName: 'Goethe Vocab List',
    ord,
    deckName: 'German',
    interval: 0,
    note,
    type: 0,
    queue: 0,
    due: cardId,
    reps: 0,
    lapses: 0,
    left: 0,
    mod: 0,
    flags: 0,
    ...options,
  }
}

beforeEach(() => {
  mocks.invoke.mockReset()
  mocks.multi.mockReset()
})

describe('deck API', () => {
  it('lists only top-level decks', async () => {
    mocks.invoke.mockResolvedValue({
      Default: 1,
      German: 2,
      'German::Chapter 1': 3,
    })
    await expect(listDecks()).resolves.toEqual([
      { id: 1, name: 'Default', supported: true, modelNames: [], subdeckCount: 0 },
      { id: 2, name: 'German', supported: true, modelNames: [], subdeckCount: 1 },
    ])
  })
})

describe('lesson integration', () => {
  it('builds note-pair batches within the Anki new-card limit', async () => {
    mocks.invoke.mockImplementation(async (action: string) => {
      if (action === 'getDeckStats') {
        return {
          2: {
            deck_id: 2,
            name: 'German',
            new_count: 4,
            learn_count: 0,
            review_count: 0,
            total_in_deck: 4,
          },
        }
      }
      if (action === 'findCards') return [1, 2, 3, 4]
      if (action === 'cardsInfo') {
        return [
          ankiCard(1, 10, 0),
          ankiCard(2, 10, 1),
          ankiCard(3, 20, 0),
          ankiCard(4, 20, 1),
        ]
      }
      throw new Error(`Unexpected action ${action}`)
    })

    const lesson = await getLessonSession('German', GOETHE_MAPPING)
    expect(lesson.items).toHaveLength(2)
    expect(lesson.quizCards).toHaveLength(4)
    expect(new Set(lesson.quizCards.map((card) => card.noteId))).toEqual(
      new Set([10, 20]),
    )
  })

  it('returns no lesson when Anki daily limit is exhausted', async () => {
    mocks.invoke.mockResolvedValue({
      2: {
        deck_id: 2,
        name: 'German',
        new_count: 0,
        learn_count: 0,
        review_count: 0,
        total_in_deck: 4,
      },
    })
    await expect(getLessonSession('German', GOETHE_MAPPING)).resolves.toEqual({
      deckName: 'German',
      items: [],
      quizCards: [],
    })
  })

  it('finds enabled note types beyond incompatible new cards', async () => {
    const ids = Array.from({ length: 202 }, (_, index) => index + 1)
    mocks.invoke.mockImplementation(
      async (action: string, params: { cards?: number[] }) => {
        if (action === 'getDeckStats') {
          return {
            2: {
              deck_id: 2,
              name: 'German',
              new_count: 2,
              learn_count: 0,
              review_count: 0,
              total_in_deck: 202,
            },
          }
        }
        if (action === 'findCards') return ids
        if (action === 'cardsInfo') {
          return (params.cards ?? []).map((cardId) =>
            cardId <= 200
              ? ankiCard(cardId, cardId, 0, {
                  modelName: 'Disabled note type',
                })
              : ankiCard(cardId, 500, cardId === 201 ? 0 : 1),
          )
        }
        throw new Error(`Unexpected action ${action}`)
      },
    )

    const lesson = await getLessonSession('German', GOETHE_MAPPING)
    expect(lesson.items).toHaveLength(1)
    expect(lesson.quizCards).toHaveLength(2)
  })
})

describe('card loading', () => {
  it('chunks large cardsInfo requests before sending them to AnkiConnect', async () => {
    mocks.invoke.mockImplementation(
      async (action: string, params: { cards?: number[] }) => {
        if (action !== 'cardsInfo') throw new Error(`Unexpected action ${action}`)
        return (params.cards ?? []).map((cardId) =>
          ankiCard(cardId, cardId, 0),
        )
      },
    )
    const ids = Array.from({ length: 501 }, (_, index) => index + 1)

    await expect(getCards(ids, 'German', GOETHE_MAPPING)).resolves.toHaveLength(
      501,
    )
    const cardCalls = mocks.invoke.mock.calls.filter(
      ([action]) => action === 'cardsInfo',
    )
    expect(cardCalls).toHaveLength(2)
    expect(cardCalls[0]?.[1].cards).toHaveLength(500)
    expect(cardCalls[1]?.[1].cards).toHaveLength(1)
  })
})

describe('review integration', () => {
  it('combines learning and limited review queues without siblings adjacent', async () => {
    mocks.invoke.mockImplementation(async (action: string) => {
      if (action === 'getDeckStats') {
        return {
          2: {
            deck_id: 2,
            name: 'German',
            new_count: 0,
            learn_count: 1,
            review_count: 2,
            total_in_deck: 3,
          },
        }
      }
      if (action === 'cardsInfo') {
        return [
          ankiCard(1, 10, 0, { type: 1, queue: 1 }),
          ankiCard(2, 10, 1, { type: 2, queue: 2, interval: 4 }),
          ankiCard(3, 20, 0, { type: 2, queue: 2, interval: 8 }),
        ]
      }
      throw new Error(`Unexpected action ${action}`)
    })
    mocks.multi.mockResolvedValue([[1], [2, 3, 99]])

    const session = await getReviewSession('German', GOETHE_MAPPING)
    expect(session.cards.map((card) => card.cardId)).toEqual([1, 3, 2])
    expect(session.cards).toHaveLength(3)
  })
})

describe('grade integration', () => {
  it('sends only the requested card and allowed grade', async () => {
    mocks.invoke.mockResolvedValue([true])
    await expect(answerCard(42, 3)).resolves.toEqual({
      saved: true,
      cardId: 42,
      ease: 3,
    })
    expect(mocks.invoke).toHaveBeenCalledWith('answerCards', {
      answers: [{ cardId: 42, ease: 3 }],
    })
  })

  it('marks missing stale cards without trapping the session', async () => {
    mocks.invoke.mockResolvedValue([false])
    await expect(answerCard(42, 1)).resolves.toEqual({
      saved: false,
      stale: true,
      cardId: 42,
      ease: 1,
    })
  })

  it('deduplicates a repeated grading request', async () => {
    mocks.invoke.mockResolvedValue([true])
    await answerCard(42, 3, 'same-request')
    await answerCard(42, 3, 'same-request')

    expect(mocks.invoke).toHaveBeenCalledTimes(1)
  })
})

describe('dashboard integration', () => {
  it('counts tuple-shaped Anki review logs and ignores manual ease zero rows', async () => {
    const now = Date.now()
    const yesterday = now - 86_400_000
    mocks.invoke.mockImplementation(async (action: string) => {
      if (action === 'getDeckStats') {
        return {
          2: {
            deck_id: 2,
            name: 'German',
            new_count: 0,
            learn_count: 0,
            review_count: 2,
            total_in_deck: 2,
          },
        }
      }
      if (action === 'findCards') return [1, 2]
      if (action === 'cardReviews') {
        return [
          [now, 1, -1, 3, 1, 0, 2500, 100, 0],
          [now + 1, 1, -1, 0, 1, 1, 2500, 0, 4],
          [yesterday, 2, -1, 1, -60, 1, 2500, 100, 0],
        ]
      }
      if (action === 'cardsInfo') {
        return [
          ankiCard(1, 10, 0, { type: 2, queue: 2, interval: 3 }),
          ankiCard(2, 10, 1, { type: 2, queue: 2, interval: 5 }),
        ]
      }
      throw new Error(`Unexpected action ${action}`)
    })
    mocks.multi.mockResolvedValue([[], [], [], [], [], [], []])

    const result = await getDashboard('German', GOETHE_MAPPING)
    expect(result.completedToday).toBe(1)
    expect(result.completedYesterday).toBe(1)
    expect(result.currentStreak).toBe(2)
    expect(result.bestStreak).toBe(2)
  })
})
