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

async function request<T>(path: string, init?: RequestInit, timeoutMs = 8_000): Promise<T> {
  const controller = new AbortController()
  const timeout = timeoutMs ? globalThis.setTimeout(() => controller.abort(), timeoutMs) : undefined
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      signal: init?.signal ?? controller.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('The request did not finish in time.', 'TIMEOUT', 408)
    }
    throw new ApiError('The connection was interrupted.', 'NETWORK')
  } finally {
    if (timeout) globalThis.clearTimeout(timeout)
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

function post<T>(path: string, body: unknown, signal?:AbortSignal) {
  return request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
}

function get<T>(path: string, signal?:AbortSignal) {
  return request<T>(path,{signal})
}

function answerPost<T>(path: string, body: unknown) {
  return request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export type PackageImportReport = {file:string;kind:'apkg'|'colpkg';decks:number;notes:number;cards:number;reviews:number;media:number;compatibility:Array<{modelName:string;status:string;reason:string}>;backup:string|null}

export const api = {
  health: (signal?:AbortSignal) =>
    get<{
      connected: boolean
      version: number
      endpoint: string
      profileName: string
    }>(
      '/api/health', signal,
    ),
  decks: (signal?:AbortSignal) => get<DeckSummary[]>('/api/decks',signal),
  profile: (deck: string, signal?:AbortSignal) =>
    get<DeckProfile>(`/api/profile?deck=${encodeURIComponent(deck)}`,signal),
  settings: (deck: string, signal?:AbortSignal) =>
    get<SchedulingSettings>(`/api/settings?deck=${encodeURIComponent(deck)}`,signal),
  updateSettings: (deck: string, settings: SchedulingSettings) =>
    request<SchedulingSettings>('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deck, settings }),
    }),
  importPackage: (file: File) => {
    const form = new FormData()
    form.set('package', file)
    return request<PackageImportReport>('/api/import',{method:'POST',body:form},0)
  },
  backups: (signal?:AbortSignal) => get<string[]>('/api/backups',signal),
  restoreBackup: (name:string) => request<{backup:string|null}>('/api/backups/restore',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name}),
  },0),
  dashboard: (deck: string, config: StudyConfig, signal?:AbortSignal) =>
    post<DashboardData>('/api/dashboard', { deck, config },signal),
  reviews: (deck: string, config: StudyConfig, signal?:AbortSignal) =>
    post<SessionPayload>('/api/sessions/reviews', { deck, config },signal),
  lessons: (deck: string, config: StudyConfig, signal?:AbortSignal) =>
    post<LessonPayload>('/api/sessions/lessons', { deck, config },signal),
  cards: (deck: string, cardIds: number[], config: StudyConfig, signal?:AbortSignal) =>
    post<StudyCard[]>('/api/cards', { deck, cardIds, config },signal),
  answer: (cardId: number, ease: 1 | 3, requestId: string) =>
    answerPost<{
      saved: boolean
      stale?: true
      cardId: number
      ease: 1 | 3
    }>('/api/answer', {
      cardId,
      ease,
      requestId,
    }),
  mediaUrl: (filename: string) =>
    `/api/media?filename=${encodeURIComponent(filename)}`,
}
