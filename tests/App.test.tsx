// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DashboardData,
  FieldMapping,
  StudyCard,
} from '../src/lib/domain'

const mocks = vi.hoisted(() => ({
  health: vi.fn(),
  decks: vi.fn(),
  profile: vi.fn(),
  dashboard: vi.fn(),
  reviews: vi.fn(),
  lessons: vi.fn(),
  cards: vi.fn(),
  answer: vi.fn(),
}))

vi.mock('../src/lib/api', () => ({
  api: {
    ...mocks,
    mediaUrl: (filename: string) => `/api/media?filename=${filename}`,
  },
}))

import App from '../src/App'

const mapping: FieldMapping = {
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

const dashboard: DashboardData = {
  deckName: 'German',
  lessonsAvailable: 2,
  reviewsDue: 7,
  learning: 1,
  completedToday: 3,
  completedYesterday: 4,
  currentStreak: 2,
  bestStreak: 5,
  next24Hours: 6,
  forecast: Array.from({ length: 7 }, (_, index) => ({
    date: `2026-07-${`${28 + index}`.padStart(2, '0')}`,
    label: index ? `Day ${index}` : 'Today',
    count: index,
    cardIds: [],
  })),
  activeSpread: Array.from({ length: 8 }, (_, index) => ({
    key: `${index}`,
    label: `${index}`,
    total: index,
    forwardWeak: index,
    reverseWeak: 0,
    balanced: 0,
  })),
  totalCards: 100,
  updatedAt: new Date().toISOString(),
}

const reviewCard: StudyCard = {
  cardId: 10,
  noteId: 5,
  modelName: 'Goethe Vocab List',
  direction: 'reverse',
  directionLabel: 'English → German',
  prompt: 'announcement',
  canonicalAnswer: 'die Ansage',
  acceptedAnswers: ['die Ansage'],
  sourceWord: 'die Ansage, -n',
  targetMeaning: 'announcement',
  sourceExample: 'Hören Sie auf die Ansagen.',
  targetExample: 'Listen to the announcements.',
  note: '',
  audioFilename: 'ansage.mp3',
  interval: 4,
  type: 2,
  queue: 2,
  due: 1,
  reps: 2,
  lapses: 0,
}

function supportedProfile(deckName = 'German') {
  return {
    deckName,
    modelNames: ['Goethe Vocab List'],
    fieldsByModel: {
      'Goethe Vocab List': [
        'de_word',
        'de_sentence',
        'en_word',
        'en_sentence',
        'en_note',
        'de_audio',
      ],
    },
    templatesByModel: {
      'Goethe Vocab List': {
        'Card 1': { Front: '', Back: '' },
        'Card 2': { Front: '', Back: '' },
      },
    },
    suggestedMapping: mapping,
  }
}

beforeEach(() => {
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue()
  localStorage.clear()
  window.history.replaceState({}, '', '/')
  mocks.health.mockReset().mockResolvedValue({
    connected: true,
    version: 6,
    endpoint: 'http://127.0.0.1:8765',
  })
  mocks.decks.mockReset().mockResolvedValue([
    { id: 1, name: 'Default', supported: false, modelNames: [] },
    { id: 2, name: 'German', supported: true, modelNames: ['Goethe Vocab List'] },
  ])
  mocks.profile.mockReset().mockImplementation(async (deck: string) =>
    deck === 'Default'
      ? {
          deckName: 'Default',
          modelNames: [],
          fieldsByModel: {},
          templatesByModel: {},
          suggestedMapping: null,
        }
      : supportedProfile(deck),
  )
  mocks.dashboard.mockReset().mockResolvedValue(dashboard)
  mocks.reviews.mockReset().mockResolvedValue({ deckName: 'German', cards: [] })
  mocks.lessons.mockReset().mockResolvedValue({
    deckName: 'German',
    items: [],
    quizCards: [],
  })
  mocks.cards.mockReset().mockResolvedValue([])
  mocks.answer.mockReset().mockResolvedValue({ saved: true, cardId: 1, ease: 3 })
})

afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
})

describe('application integration', () => {
  it('restores and updates active deck selection through localStorage', async () => {
    localStorage.setItem('ankikani.activeDeck', 'German')
    render(() => <App />)

    const selector = await screen.findByRole('combobox', { name: 'Active deck' })
    expect((selector as HTMLSelectElement).value).toBe('German')
    await screen.findByRole('heading', { name: 'Lessons' })
    expect(screen.queryByText('Recall, then reveal')).toBeNull()
    expect(screen.queryByText('Deck dashboard')).toBeNull()
    expect(screen.queryByText('Next 24 hours')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Today\b/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull()
    fireEvent.change(selector, { target: { value: 'Default' } })

    await screen.findByText('Nothing to study here yet')
    expect(localStorage.getItem('ankikani.activeDeck')).toBe('Default')
  })

  it('shows field mapping for an unsupported note schema', async () => {
    localStorage.setItem('ankikani.activeDeck', 'German')
    mocks.profile.mockResolvedValue({
      deckName: 'German',
      modelNames: ['Basic'],
      fieldsByModel: { Basic: ['Front', 'Back'] },
      templatesByModel: {
        Basic: {
          Forward: { Front: '', Back: '' },
          Reverse: { Front: '', Back: '' },
        },
      },
      suggestedMapping: null,
    })

    render(() => <App />)
    await screen.findByRole('heading', { name: 'Map vocabulary fields' })
    expect(screen.getByText('Source word')).toBeTruthy()
    expect(screen.getByText('Target meaning')).toBeTruthy()
  })

  it('recovers from a disconnected Anki state through Retry', async () => {
    mocks.health
      .mockRejectedValueOnce(new Error('AnkiConnect is unavailable'))
      .mockResolvedValueOnce({
        connected: true,
        version: 6,
        endpoint: 'http://127.0.0.1:8765',
      })

    render(() => <App />)
    const retry = await screen.findByRole('button', { name: 'Retry connection' })
    fireEvent.click(retry)

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Active deck' })).toBeTruthy()
    })
  })

  it('resumes a review in correction state without losing the typed answer', async () => {
    localStorage.setItem('ankikani.activeDeck', 'German')
    localStorage.setItem(
      'ankikani.session.German.review',
      JSON.stringify({
        index: 0,
        phase: 'correction',
        input: 'der Ansage',
        result: null,
        cards: [reviewCard],
      }),
    )
    mocks.reviews.mockResolvedValue({
      deckName: 'German',
      cards: [reviewCard],
    })

    render(() => <App />)
    await screen.findByText('Expected answer')
    expect(window.location.pathname).toBe('/reviews')
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
      'der Ansage',
    )
    expect(screen.getByText('die Ansage')).toBeTruthy()
  })

  it('uses dedicated routes for reviews and lessons', async () => {
    localStorage.setItem('ankikani.activeDeck', 'German')
    mocks.reviews.mockResolvedValue({
      deckName: 'German',
      cards: [reviewCard],
    })
    mocks.lessons.mockResolvedValue({
      deckName: 'German',
      items: [{
        noteId: reviewCard.noteId,
        sourceWord: reviewCard.sourceWord,
        targetMeaning: reviewCard.targetMeaning,
        sourceExample: reviewCard.sourceExample,
        targetExample: reviewCard.targetExample,
        note: reviewCard.note,
        audioFilename: reviewCard.audioFilename,
        cards: [reviewCard],
      }],
      quizCards: [reviewCard],
    })

    render(() => <App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start reviews' }))
    await screen.findByText(reviewCard.prompt)
    expect(window.location.pathname).toBe('/reviews')
    expect(screen.queryByText('Recall this')).toBeNull()
    expect(screen.queryByText('1 / 1')).toBeNull()
    expect(screen.getByRole('progressbar', { name: 'Session progress' }).getAttribute('aria-valuenow')).toBe('1')
    fireEvent.input(screen.getByRole('textbox'), {
      target: { value: reviewCard.canonicalAnswer },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }))
    await screen.findByRole('button', { name: 'Continue' })
    expect(screen.queryByText('Correct')).toBeNull()
    expect(screen.getByRole('textbox').closest('.card-shell')?.getAttribute('style')).toContain('var(--mint-soft)')

    fireEvent.click(screen.getByRole('button', { name: 'Open dashboard' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Start lessons' }))
    await screen.findByText(reviewCard.sourceWord)
    expect(window.location.pathname).toBe('/lessons')
  })
})
