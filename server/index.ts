import { Cause, Effect } from 'effect'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import {
  answerCard,
  getCards,
  getDashboard,
  getDeckProfile,
  getLessonSession,
  getReviewSession,
  listDecks,
  mediaFile,
  providerHealth,
  getSettings,
  updateSettings,
} from './provider'
import { AnkiUnavailableError } from './anki'
import type { StudyConfig } from '../src/lib/domain'
import type { SchedulingSettings } from '../src/lib/domain'
import { importPackageBytes } from './package-import'
import { listCollectionBackups, restoreCollectionBackup } from './collection-import'

const PORT = Number(process.env.PORT ?? 3001)
const DIST = fileURLToPath(new URL('../dist', import.meta.url))

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

function requestJson<T>(request: Request) {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return Effect.fail(new Error('Expected application/json request.'))
  }
  return fromIO(() => request.json() as Promise<T>)
}

function contentType(filename: string) {
  const extension = filename.split('.').at(-1)?.toLowerCase()
  return (
    {
      mp3: 'audio/mpeg',
      ogg: 'audio/ogg',
      wav: 'audio/wav',
      webm: 'audio/webm',
      m4a: 'audio/mp4',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
    }[extension ?? ''] ?? 'application/octet-stream'
  )
}

function fromIO<T>(operation: () => T | Promise<T>) {
  return Effect.tryPromise({ try: async () => operation(), catch: (cause) => cause })
}

const api = Effect.fn('handleApiRequest')(function* (request: Request, url: URL) {
  if (!url.pathname.startsWith('/api/')) return null

  if (url.pathname === '/api/health' && request.method === 'GET') {
    return json(yield* providerHealth())
  }
  if (url.pathname === '/api/decks' && request.method === 'GET') {
    return json(yield* listDecks())
  }
  if (url.pathname === '/api/settings' && request.method === 'GET') {
    const deck = url.searchParams.get('deck')
    if (!deck) return json({ error: 'Missing deck.' }, 400)
    return json(getSettings(deck))
  }
  if (url.pathname === '/api/settings' && request.method === 'PUT') {
    const body = yield* requestJson<{ deck: string; settings: SchedulingSettings }>(request)
    return json(updateSettings(body.deck, body.settings))
  }
  if (url.pathname === '/api/import' && request.method === 'POST') {
    const length = Number(request.headers.get('content-length') ?? 0)
    if (length > 1024*1024*1024) return json({ error: 'Package files larger than 1 GB are not supported.' }, 413)
    const form = yield* fromIO(() => request.formData())
    const upload = form.get('package')
    if (!(upload instanceof File)) return json({ error: 'Missing package file.' }, 400)
    const extension = upload.name.toLowerCase().endsWith('.colpkg') ? 'colpkg' : upload.name.toLowerCase().endsWith('.apkg') ? 'apkg' : null
    if (!extension) return json({ error: 'Choose an .apkg or .colpkg file.' }, 400)
    if (upload.size > 1024*1024*1024) return json({ error: 'Package files larger than 1 GB are not supported.' }, 413)
    const bytes = yield* fromIO(() => upload.arrayBuffer())
    return json(yield* fromIO(() => importPackageBytes(new Uint8Array(bytes), upload.name, extension)))
  }
  if (url.pathname === '/api/backups' && request.method === 'GET') return json(listCollectionBackups())
  if (url.pathname === '/api/backups/restore' && request.method === 'POST') {
    const body = yield* requestJson<{name:string}>(request)
    return json({backup:restoreCollectionBackup(body.name)})
  }
  if (url.pathname === '/api/profile' && request.method === 'GET') {
    const deck = url.searchParams.get('deck')
    if (!deck) return json({ error: 'Missing deck.' }, 400)
    return json(yield* getDeckProfile(deck))
  }
  if (url.pathname === '/api/dashboard' && request.method === 'POST') {
    const body = yield* requestJson<{ deck: string; config: StudyConfig }>(request)
    return json(yield* getDashboard(body.deck, body.config))
  }
  if (url.pathname === '/api/sessions/reviews' && request.method === 'POST') {
    const body = yield* requestJson<{ deck: string; config: StudyConfig }>(request)
    return json(yield* getReviewSession(body.deck, body.config))
  }
  if (url.pathname === '/api/sessions/lessons' && request.method === 'POST') {
    const body = yield* requestJson<{ deck: string; config: StudyConfig }>(request)
    return json(yield* getLessonSession(body.deck, body.config))
  }
  if (url.pathname === '/api/cards' && request.method === 'POST') {
    const body = yield* requestJson<{
      deck: string
      cardIds: number[]
      config: StudyConfig
    }>(request)
    if (body.cardIds.length > 500) return json({ error: 'Too many cards.' }, 400)
    return json(yield* getCards(body.cardIds, body.deck, body.config))
  }
  if (url.pathname === '/api/answer' && request.method === 'POST') {
    const body = yield* requestJson<{
      cardId: number
      ease: number
      requestId?: string
    }>(request)
    const { cardId, ease, requestId } = body
    if (ease !== 1 && ease !== 3) {
      return json({ error: 'Only Again (1) and Good (3) are allowed.' }, 400)
    }
    return json(yield* answerCard(cardId, ease, requestId))
  }
  if (url.pathname === '/api/media' && request.method === 'GET') {
    const filename = url.searchParams.get('filename') ?? ''
    const bytes = yield* mediaFile(filename)
    if (!bytes) return json({ error: 'Media not found.' }, 404)
    return new Response(bytes, {
      headers: {
        'content-type': contentType(filename),
        // Media filenames can refer to different bytes after an Anki profile
        // switch, while the browser URL remains unchanged.
        'cache-control': 'no-store',
      },
    })
  }

  return json({ error: 'Not found.' }, 404)
})

export async function handleApiRequest(
  request: Request,
): Promise<Response | null> {
  return Effect.runPromise(api(request, new URL(request.url)).pipe(
    Effect.catchCause((cause) => {
      const error = Cause.squash(cause)
      const unavailable = error instanceof AnkiUnavailableError
      return Effect.succeed(json({
        error: error instanceof Error ? error.message : 'Unexpected error.',
        code: unavailable ? 'ANKI_UNAVAILABLE' : 'REQUEST_FAILED',
      }, unavailable ? 503 : 500))
    }),
  ))
}

async function serveStatic(url: URL): Promise<Response> {
  const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
  const resolved = path.resolve(DIST, relative)
  if (!resolved.startsWith(`${DIST}${path.sep}`) && resolved !== path.join(DIST, 'index.html')) {
    return new Response('Not found', { status: 404 })
  }

  const file = Bun.file(resolved)
  if (await file.exists()) return new Response(file)
  const fallback = Bun.file(path.join(DIST, 'index.html'))
  if (await fallback.exists()) return new Response(fallback)
  return json(
    {
      error:
        'Frontend build not found. Run `bun run dev` for development or `bun run build` before `bun start`.',
    },
    503,
  )
}

function startProductionServer() {
  const server = Bun.serve({
    hostname: '0.0.0.0',
    port: PORT,
    async fetch(request) {
      const url = new URL(request.url)
      return (await handleApiRequest(request)) ?? serveStatic(url)
    },
  })

  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter(
      (address): address is NonNullable<typeof address> =>
        Boolean(address && address.family === 'IPv4' && !address.internal),
    )
    .map((address) => `http://${address.address}:${server.port}`)

  console.log(`AnkiKani ready at http://127.0.0.1:${server.port}`)
  for (const address of addresses) console.log(`LAN: ${address}`)
}

if (import.meta.main) startProductionServer()
