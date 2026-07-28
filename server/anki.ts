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

let requestQueue: Promise<void> = Promise.resolve()

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function invokeWithRetry<T>(
  action: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(ANKI_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, version: API_VERSION, params }),
        signal: AbortSignal.timeout(8_000),
      })
      if (!response.ok) {
        if ([502, 503].includes(response.status) && attempt < 2) {
          await wait(100 * (attempt + 1))
          continue
        }
        throw new AnkiUnavailableError(
          `AnkiConnect returned HTTP ${response.status}.`,
        )
      }

      const envelope = (await response.json()) as AnkiEnvelope<T>
      if (envelope.error) throw new Error(envelope.error)
      return envelope.result
    } catch (error) {
      if (error instanceof AnkiUnavailableError) throw error
      if (
        error instanceof Error &&
        !['AbortError', 'TimeoutError', 'TypeError'].includes(error.name)
      ) {
        throw error
      }
      if (attempt < 2) {
        await wait(100 * (attempt + 1))
        continue
      }
      throw new AnkiUnavailableError(
        `Could not reach AnkiConnect at ${ANKI_URL}. Start Anki Desktop and check the add-on.`,
      )
    }
  }
  throw new AnkiUnavailableError()
}

export function ankiInvoke<T>(
  action: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const request = requestQueue.then(() => invokeWithRetry<T>(action, params))
  requestQueue = request.then(
    () => undefined,
    () => undefined,
  )
  return request
}

export async function ankiMulti<T extends unknown[]>(
  actions: Array<{ action: string; params?: Record<string, unknown> }>,
): Promise<T> {
  return ankiInvoke<T>('multi', {
    actions: actions.map(({ action, params = {} }) => ({ action, params })),
  })
}

export async function ankiHealth() {
  const [version, profileName] = await Promise.all([
    ankiInvoke<number>('version'),
    ankiInvoke<string>('getActiveProfile'),
  ])
  return { connected: true, version, endpoint: ANKI_URL, profileName }
}
