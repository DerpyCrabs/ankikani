import type {
  DashboardData,
  DeckProfile,
  DeckSummary,
  FieldMapping,
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
  const response = await fetch(path, init)
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

function post<T>(path: string, body: unknown) {
  return request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export const api = {
  health: () =>
    request<{ connected: boolean; version: number; endpoint: string }>(
      '/api/health',
    ),
  decks: () => request<DeckSummary[]>('/api/decks'),
  profile: (deck: string) =>
    request<DeckProfile>(`/api/profile?deck=${encodeURIComponent(deck)}`),
  dashboard: (deck: string, mapping: FieldMapping) =>
    post<DashboardData>('/api/dashboard', { deck, mapping }),
  reviews: (deck: string, mapping: FieldMapping) =>
    post<SessionPayload>('/api/sessions/reviews', { deck, mapping }),
  lessons: (deck: string, mapping: FieldMapping) =>
    post<LessonPayload>('/api/sessions/lessons', { deck, mapping }),
  cards: (cardIds: number[], mapping: FieldMapping) =>
    post<StudyCard[]>('/api/cards', { cardIds, mapping }),
  answer: (cardId: number, ease: 1 | 3) =>
    post<{ saved: true; cardId: number; ease: 1 | 3 }>('/api/answer', {
      cardId,
      ease,
    }),
  mediaUrl: (filename: string) =>
    `/api/media?filename=${encodeURIComponent(filename)}`,
}
