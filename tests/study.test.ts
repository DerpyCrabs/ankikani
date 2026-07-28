import { describe, expect, it } from 'vitest'
import type { StudyCard } from '../src/lib/domain'
import {
  activeSpread,
  buildStudyQueue,
  calculateStreak,
  stageIndex,
} from '../src/lib/study'

function card(
  cardId: number,
  noteId: number,
  direction: 'forward' | 'reverse',
  interval: number,
  type = 2,
  queue = 2,
): StudyCard {
  return {
    cardId,
    noteId,
    modelName: 'Goethe Vocab List',
    direction,
    directionLabel: direction,
    prompt: `${cardId}`,
    canonicalAnswer: `${cardId}`,
    acceptedAnswers: [`${cardId}`],
    sourceWord: 'Wort',
    targetMeaning: 'word',
    sourceExample: '',
    targetExample: '',
    note: '',
    audioFilename: null,
    interval,
    type,
    queue,
    due: cardId,
    reps: 1,
    lapses: 0,
  }
}

describe('review queue', () => {
  it('prioritizes learning then reviews', () => {
    const queue = buildStudyQueue([
      card(1, 1, 'forward', 10),
      card(2, 2, 'forward', 0, 1, 1),
      card(3, 3, 'forward', 5),
    ])
    expect(queue.map((item) => item.cardId)).toEqual([2, 1, 3])
  })

  it('separates sibling cards when another note is available', () => {
    const queue = buildStudyQueue([
      card(1, 1, 'forward', 1),
      card(2, 1, 'reverse', 1),
      card(3, 2, 'forward', 1),
      card(4, 2, 'reverse', 1),
    ])
    expect(queue.map((item) => item.noteId)).toEqual([1, 2, 1, 2])
  })

  it('excludes suspended and buried queue values', () => {
    const queue = buildStudyQueue([
      card(1, 1, 'forward', 1, 2, -1),
      card(2, 2, 'forward', 1, 2, -2),
      card(3, 3, 'forward', 1),
    ])
    expect(queue.map((item) => item.cardId)).toEqual([3])
  })
})

describe('active item spread', () => {
  it('uses the weaker sibling interval once per note', () => {
    const spread = activeSpread([
      card(1, 1, 'forward', 35),
      card(2, 1, 'reverse', 5),
      card(3, 2, 'forward', 12),
      card(4, 2, 'reverse', 12),
    ])
    expect(spread.stages[3]).toMatchObject({
      label: '4–7 days',
      total: 1,
      segments: { 'weak:reverse weaker': 1 },
    })
    expect(spread.stages[4]).toMatchObject({
      label: '8–14 days',
      total: 1,
      segments: { balanced: 1 },
    })
    expect(spread.legend.map((item) => item.label)).toEqual([
      'reverse weaker',
      'Balanced',
    ])
  })

  it('uses all eight interval buckets', () => {
    expect(stageIndex(card(1, 1, 'forward', 0, 1, 1))).toBe(0)
    expect(stageIndex(card(1, 1, 'forward', 0.5))).toBe(1)
    expect(stageIndex(card(1, 1, 'forward', 3))).toBe(2)
    expect(stageIndex(card(1, 1, 'forward', 7))).toBe(3)
    expect(stageIndex(card(1, 1, 'forward', 14))).toBe(4)
    expect(stageIndex(card(1, 1, 'forward', 30))).toBe(5)
    expect(stageIndex(card(1, 1, 'forward', 90))).toBe(6)
    expect(stageIndex(card(1, 1, 'forward', 91))).toBe(7)
  })

  it('places one-direction notes at their actual stage', () => {
    const spread = activeSpread([
      card(1, 1, 'forward', 30),
      card(2, 2, 'reverse', 7),
    ])
    expect(spread.stages[3]).toMatchObject({
      total: 1,
      segments: { 'content:reverse': 1 },
    })
    expect(spread.stages[5]).toMatchObject({
      total: 1,
      segments: { 'content:forward': 1 },
    })
    expect(spread.stages[0].total).toBe(0)
  })
})

describe('study streak', () => {
  it('calculates current and best local-day streaks', () => {
    const now = new Date('2026-07-28T12:00:00')
    const reviewIds = [
      new Date('2026-07-28T09:00:00').getTime(),
      new Date('2026-07-27T20:00:00').getTime(),
      new Date('2026-07-26T10:00:00').getTime(),
      new Date('2026-07-20T10:00:00').getTime(),
      new Date('2026-07-19T10:00:00').getTime(),
      new Date('2026-07-18T10:00:00').getTime(),
      new Date('2026-07-17T10:00:00').getTime(),
    ]
    expect(calculateStreak(reviewIds, now)).toMatchObject({
      current: 3,
      best: 4,
    })
  })

  it('keeps yesterday-ending streak alive before first review today', () => {
    const now = new Date('2026-07-28T08:00:00')
    const ids = [
      new Date('2026-07-27T10:00:00').getTime(),
      new Date('2026-07-26T10:00:00').getTime(),
    ]
    expect(calculateStreak(ids, now).current).toBe(2)
  })
})
