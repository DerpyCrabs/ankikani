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
import { profileKey } from '../src/lib/storage'

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
    segments: { reverse: index },
  })),
  spreadLegend: [{ key: 'reverse', label: 'English → German weaker' }],
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
  promptLanguage: 'english',
  canonicalAnswer: 'die Ansage',
  answerLanguage: 'german',
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
    profileName: 'Test',
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
    expect(localStorage.getItem(profileKey('Test'))).toBe('Default')
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
    await screen.findByRole('heading', { name: 'Deck setup' })
    expect(screen.getByText('Prompt')).toBeTruthy()
    expect(screen.getByText('Answer')).toBeTruthy()
  })

  it('recovers from a disconnected Anki state through Retry', async () => {
    mocks.health
      .mockRejectedValueOnce(new Error('AnkiConnect is unavailable'))
      .mockResolvedValueOnce({
        connected: true,
        version: 6,
        endpoint: 'http://127.0.0.1:8765',
        profileName: 'Test',
      })

    render(() => <App />)
    const retry = await screen.findByRole('button', { name: 'Retry connection' })
    fireEvent.click(retry)

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Active deck' })).toBeTruthy()
    })
  })

  it('resumes correction details without losing the typed answer', async () => {
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
    window.history.replaceState({}, '', '/reviews')

    render(() => <App />)
    await screen.findByRole('button', { name: 'Check correction' })
    expect(window.location.pathname).toBe('/reviews')
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
      'der Ansage',
    )
    const expectedAnswer = screen.getByLabelText('die Ansage')
    expect(expectedAnswer.querySelector('.text-red-600')?.textContent).toBe('die')
    expect(screen.getByText(reviewCard.sourceExample)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Replay audio' })).toBeTruthy()
  })

  it('does not color article-like text on non-German cards', async () => {
    const englishCard: StudyCard = {
      ...reviewCard,
      direction: 'forward',
      prompt: 'movie title',
      promptLanguage: 'english',
      canonicalAnswer: 'die hard',
      answerLanguage: 'english',
      acceptedAnswers: ['die hard'],
    }
    localStorage.setItem('ankikani.activeDeck', 'German')
    localStorage.setItem(
      'ankikani.session.German.review',
      JSON.stringify({
        index: 0,
        phase: 'correction',
        input: 'wrong',
        result: null,
        cards: [englishCard],
      }),
    )
    mocks.reviews.mockResolvedValue({
      deckName: 'German',
      cards: [englishCard],
    })
    window.history.replaceState({}, '', '/reviews')

    render(() => <App />)
    await screen.findByRole('button', { name: 'Check correction' })
    const expectedAnswer = screen.getByText('die hard')
    expect(expectedAnswer.querySelector('.text-red-600')).toBeNull()
  })

  it('shows old details for correction then advances after one confirmation', async () => {
    const nextCard: StudyCard = {
      ...reviewCard,
      cardId: reviewCard.cardId + 1,
      noteId: reviewCard.noteId + 1,
      prompt: 'connection',
      canonicalAnswer: 'die Verbindung',
      acceptedAnswers: ['die Verbindung'],
    }
    mocks.reviews.mockResolvedValue({
      deckName: 'German',
      cards: [reviewCard, nextCard],
    })

    render(() => <App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start reviews' }))
    const input = await screen.findByRole('textbox')
    fireEvent.input(input, { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }))
    await screen.findByRole('button', { name: 'Check correction' })
    expect(mocks.answer).not.toHaveBeenCalled()
    expect(screen.getByText(reviewCard.sourceExample)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Replay audio' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Check correction' }))
    expect(mocks.answer).toHaveBeenCalledWith(
      reviewCard.cardId,
      1,
      expect.any(String),
    )
    await screen.findByRole('heading', { name: nextCard.prompt })
  })

  it('grades a corrected retype as Good from the details screen', async () => {
    const nextCard: StudyCard = {
      ...reviewCard,
      cardId: reviewCard.cardId + 1,
      noteId: reviewCard.noteId + 1,
      prompt: 'connection',
    }
    mocks.reviews.mockResolvedValue({
      deckName: 'German',
      cards: [reviewCard, nextCard],
    })

    render(() => <App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start reviews' }))
    const input = await screen.findByRole('textbox')
    fireEvent.input(input, { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }))
    await screen.findByRole('button', { name: 'Check correction' })

    fireEvent.input(input, { target: { value: reviewCard.canonicalAnswer } })
    fireEvent.click(screen.getByRole('button', { name: 'Check correction' }))

    await screen.findByRole('button', { name: 'Continue' })
    expect(mocks.answer).toHaveBeenCalledWith(
      reviewCard.cardId,
      3,
      expect.any(String),
    )
    expect(
      screen.getByRole('textbox').closest('.card-shell')?.getAttribute('style'),
    ).toContain('var(--mint-soft)')

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: nextCard.prompt })
  })

  it('does not leave dashboard for a saved session', async () => {
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

    render(() => <App />)
    await screen.findByRole('heading', { name: 'Lessons' })
    expect(window.location.pathname).toBe('/')
    expect(screen.queryByText('Expected answer')).toBeNull()
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
    const lessonAnswer = await screen.findByLabelText(
      reviewCard.canonicalAnswer,
    )
    expect(lessonAnswer.querySelector('.text-red-600')?.textContent).toBe('die')
    expect(window.location.pathname).toBe('/lessons')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(window.location.pathname).toBe('/lessons')
  })

  it('retries a failed session load without leaving the route', async () => {
    mocks.reviews
      .mockRejectedValueOnce(new Error('AnkiConnect connection was interrupted.'))
      .mockResolvedValueOnce({ deckName: 'German', cards: [reviewCard] })

    render(() => <App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start reviews' }))
    expect(await screen.findByText('Could not start session')).toBeTruthy()
    expect(window.location.pathname).toBe('/reviews')

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText(reviewCard.prompt)
    expect(window.location.pathname).toBe('/reviews')
  })

  it('preserves answer and queue position when grading fails', async () => {
    mocks.reviews.mockResolvedValue({ deckName: 'German', cards: [reviewCard] })
    mocks.answer
      .mockRejectedValueOnce(new Error('AnkiConnect connection was interrupted.'))
      .mockResolvedValueOnce({ saved: true, cardId: reviewCard.cardId, ease: 3 })

    render(() => <App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start reviews' }))
    const input = await screen.findByRole('textbox')
    fireEvent.input(input, { target: { value: reviewCard.canonicalAnswer } })
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Answer and queue position are preserved',
    )
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
      reviewCard.canonicalAnswer,
    )
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1')

    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }))
    await screen.findByRole('button', { name: 'Continue' })
    expect(screen.getByLabelText('Keyboard shortcuts').textContent).toContain('J')
    const play = vi.mocked(window.HTMLMediaElement.prototype.play)
    play.mockClear()
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'r' })
    expect(play).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'j' })
    expect(play).toHaveBeenCalledOnce()
  })
})
