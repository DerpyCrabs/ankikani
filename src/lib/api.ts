import type {
  DashboardData,
  DeckProfile,
  DeckSummary,
  StudyConfig,
  LessonPayload,
  SessionPayload,
  StudyCard,
} from './domain'

export class ApiError extends Error {
  readonly code?: string
  readonly status?: number

  constructor(message: string, code?: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), 8_000)
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      signal: init?.signal ?? controller.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('AnkiConnect did not respond in time.', 'TIMEOUT', 408)
    }
    throw new ApiError('AnkiConnect connection was interrupted.', 'NETWORK')
  } finally {
    globalThis.clearTimeout(timeout)
  }
  const contentType = response.headers.get('content-type') ?? ''
  const body = contentType.includes('application/json')
    ? ((await response.json()) as { error?: string; code?: string } & T)
    : null

  if (!response.ok) {
    throw new ApiError(
      body?.error ?? `Request failed (${response.status}).`,
      body?.code,
      response.status,
    )
  }
  return body as T
}

async function retryable<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    const retry =
      !(error instanceof ApiError) ||
      error.code === 'NETWORK' ||
      error.code === 'TIMEOUT' ||
      [502, 503, 504].includes(error.status ?? 0)
    if (!retry) throw error
    await new Promise((resolve) => globalThis.setTimeout(resolve, 250))
    return operation()
  }
}

function post<T>(path: string, body: unknown, canRetry = true) {
  const operation = () => request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return canRetry ? retryable(operation) : operation()
}

function get<T>(path: string) {
  return retryable(() => request<T>(path))
}

function answerPost<T>(path: string, body: unknown) {
  return request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export const api = {
  health: () =>
    get<{
      connected: boolean
      version: number
      endpoint: string
      profileName: string
    }>(
      '/api/health',
    ),
  decks: () => get<DeckSummary[]>('/api/decks'),
  profile: (deck: string) =>
    get<DeckProfile>(`/api/profile?deck=${encodeURIComponent(deck)}`),
  dashboard: (deck: string, config: StudyConfig) =>
    post<DashboardData>('/api/dashboard', { deck, config }),
  reviews: (deck: string, config: StudyConfig) =>
    post<SessionPayload>('/api/sessions/reviews', { deck, config }),
  lessons: (deck: string, config: StudyConfig) =>
    post<LessonPayload>('/api/sessions/lessons', { deck, config }),
  cards: (deck: string, cardIds: number[], config: StudyConfig) =>
    post<StudyCard[]>('/api/cards', { deck, cardIds, config }),
  answer: (cardId: number, ease: 1 | 3, requestId: string) =>
    answerPost<{ saved: true; cardId: number; ease: 1 | 3 }>('/api/answer', {
      cardId,
      ease,
      requestId,
    }),
  mediaUrl: (filename: string) =>
    `/api/media?filename=${encodeURIComponent(filename)}`,
}
