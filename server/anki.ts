import { Effect, Schedule, Semaphore } from 'effect'

const ANKI_URL = process.env.ANKI_CONNECT_URL ?? 'http://127.0.0.1:8765'
const API_VERSION = 6

interface AnkiEnvelope<T> {
  result: T
  error: string | null
}

export class AnkiUnavailableError extends Error {
  constructor(message = 'AnkiConnect is unavailable') {
    super(message)
    this.name = 'AnkiUnavailableError'
  }
}

const bridge = Semaphore.makeUnsafe(1)

class TransientBridgeError extends AnkiUnavailableError {}

export function invokeEffect<T>(
  action: string,
  params: Record<string, unknown> = {},
) {
  const call = Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(ANKI_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, version: API_VERSION, params }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
      })
      if (!response.ok) {
        const Failure = [502, 503].includes(response.status) ? TransientBridgeError : AnkiUnavailableError
        throw new Failure(`AnkiConnect returned HTTP ${response.status}.`)
      }
      const envelope = (await response.json()) as AnkiEnvelope<T>
      if (envelope.error) throw new Error(envelope.error)
      return envelope.result
    },
    catch: (error) => {
      if (error instanceof Error && !['AbortError', 'TimeoutError', 'TypeError'].includes(error.name)) {
        return error
      }
      return new TransientBridgeError(
        `Could not reach AnkiConnect at ${ANKI_URL}. Start Anki Desktop and check the add-on.`,
      )
    },
  })
  return call.pipe(
    Effect.retry({
      times: 2,
      schedule: Schedule.exponential(100),
      while: (failure) => failure instanceof TransientBridgeError,
    }),
    bridge.withPermit,
  )
}

export function ankiInvoke<T>(action: string, params: Record<string, unknown> = {}) {
  return Effect.runPromise(invokeEffect<T>(action, params))
}

export function multiEffect<T extends unknown[]>(actions: Array<{ action: string; params?: Record<string, unknown> }>) {
  return invokeEffect<T>('multi', {
    actions: actions.map(({ action, params = {} }) => ({ action, params })),
  })
}

export function ankiMulti<T extends unknown[]>(actions: Array<{ action: string; params?: Record<string, unknown> }>) {
  return Effect.runPromise(multiEffect<T>(actions))
}

export const ankiHealth = Effect.fn('ankiHealth')(function* () {
  const version = yield* invokeEffect<number>('version')
  const profileName = yield* invokeEffect<string>('getActiveProfile')
  return { connected: true, version, endpoint: ANKI_URL, profileName }
})
