import { Effect } from 'effect'
import type {
  DashboardData,
  DeckProfile,
  DeckSummary,
  StudyConfig,
  LessonPayload,
  SessionPayload,
  StudyCard,
  SchedulingSettings,
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

const timeoutError = () => new ApiError('The request did not finish in time.', 'TIMEOUT', 408)

function request<T>(path: string, init?: RequestInit, timeoutMs = 8_000): Effect.Effect<T, Error> {
  const fetchResponse = Effect.tryPromise({
    try: (signal) => fetch(path, { ...init, signal }),
    catch: (cause) =>
      cause instanceof Error && cause.name === 'AbortError'
        ? timeoutError()
        : new ApiError('The connection was interrupted.', 'NETWORK'),
  })
  const response =
    timeoutMs > 0
      ? Effect.timeoutOrElse(fetchResponse, {
          duration: timeoutMs,
          orElse: () => Effect.fail(timeoutError()),
        })
      : fetchResponse

  return Effect.gen(function* () {
    const result = yield* response
    const isJson = result.headers.get('content-type')?.includes('application/json')
    const body = isJson
      ? yield* Effect.tryPromise({
          try: () => result.json() as Promise<T & { error?: string; code?: string }>,
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        })
      : null
    if (!result.ok) {
      return yield* Effect.fail(
        new ApiError(body?.error ?? `Request failed (${result.status}).`, body?.code, result.status),
      )
    }
    return body as T
  })
}

function post<T>(path: string, body: unknown) {
  return request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function get<T>(path: string) {
  return request<T>(path)
}

export type PackageImportReport = {
  file: string
  kind: 'apkg' | 'colpkg'
  decks: number
  notes: number
  studyCards: number
  cards: number
  reviews: number
  media: number
  compatibility: Array<{ modelName: string; status: string; reason: string }>
  backup: string | null
}

export const api = {
  health: () =>
    get<{
      connected: boolean
      version: number
      endpoint: string
      profileName: string
    }>('/api/health'),
  decks: () => get<DeckSummary[]>('/api/decks'),
  profile: (deck: string) => get<DeckProfile>(`/api/profile?deck=${encodeURIComponent(deck)}`),
  settings: (deck: string) => get<SchedulingSettings>(`/api/settings?deck=${encodeURIComponent(deck)}`),
  updateSettings: (deck: string, settings: SchedulingSettings) =>
    request<SchedulingSettings>('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deck, settings }),
    }),
  importPackage: (file: File) => {
    const form = new FormData()
    form.set('package', file)
    return request<PackageImportReport>('/api/import', { method: 'POST', body: form }, 0)
  },
  backups: () => get<string[]>('/api/backups'),
  restoreBackup: (name: string) =>
    request<{ backup: string | null }>(
      '/api/backups/restore',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      },
      0,
    ),
  dashboard: (deck: string, config: StudyConfig) => post<DashboardData>('/api/dashboard', { deck, config }),
  reviews: (deck: string, config: StudyConfig) =>
    post<SessionPayload>('/api/sessions/reviews', { deck, config }),
  lessons: (deck: string, config: StudyConfig) =>
    post<LessonPayload>('/api/sessions/lessons', { deck, config }),
  cards: (deck: string, cardIds: number[], config: StudyConfig) =>
    post<StudyCard[]>('/api/cards', { deck, cardIds, config }),
  answer: (cardId: number, ease: 1 | 3, requestId: string) =>
    post<{
      saved: boolean
      stale?: true
      cardId: number
      ease: 1 | 3
    }>('/api/answer', {
      cardId,
      ease,
      requestId,
    }),
  mediaUrl: (filename: string) => `/api/media?filename=${encodeURIComponent(filename)}`,
}
