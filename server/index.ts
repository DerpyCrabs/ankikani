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
} from './service'
import { ankiHealth, AnkiUnavailableError } from './anki'
import type { StudyConfig } from '../src/lib/domain'

const PORT = Number(process.env.PORT ?? 3001)
const DIST = path.resolve(import.meta.dir, '..', 'dist')

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

async function requestJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new Error('Expected application/json request.')
  }
  return request.json() as Promise<T>
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

async function api(request: Request, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/')) return null

  if (url.pathname === '/api/health' && request.method === 'GET') {
    return json(await ankiHealth())
  }
  if (url.pathname === '/api/decks' && request.method === 'GET') {
    return json(await listDecks())
  }
  if (url.pathname === '/api/profile' && request.method === 'GET') {
    const deck = url.searchParams.get('deck')
    if (!deck) return json({ error: 'Missing deck.' }, 400)
    return json(await getDeckProfile(deck))
  }
  if (url.pathname === '/api/dashboard' && request.method === 'POST') {
    const body = await requestJson<{ deck: string; config: StudyConfig }>(request)
    return json(await getDashboard(body.deck, body.config))
  }
  if (url.pathname === '/api/sessions/reviews' && request.method === 'POST') {
    const body = await requestJson<{ deck: string; config: StudyConfig }>(request)
    return json(await getReviewSession(body.deck, body.config))
  }
  if (url.pathname === '/api/sessions/lessons' && request.method === 'POST') {
    const body = await requestJson<{ deck: string; config: StudyConfig }>(request)
    return json(await getLessonSession(body.deck, body.config))
  }
  if (url.pathname === '/api/cards' && request.method === 'POST') {
    const body = await requestJson<{
      deck: string
      cardIds: number[]
      config: StudyConfig
    }>(request)
    if (body.cardIds.length > 500) return json({ error: 'Too many cards.' }, 400)
    return json(await getCards(body.cardIds, body.deck, body.config))
  }
  if (url.pathname === '/api/answer' && request.method === 'POST') {
    const body = await requestJson<{
      cardId: number
      ease: number
      requestId?: string
    }>(request)
    if (body.ease !== 1 && body.ease !== 3) {
      return json({ error: 'Only Again (1) and Good (3) are allowed.' }, 400)
    }
    return json(await answerCard(body.cardId, body.ease, body.requestId))
  }
  if (url.pathname === '/api/media' && request.method === 'GET') {
    const filename = url.searchParams.get('filename') ?? ''
    const bytes = await mediaFile(filename)
    if (!bytes) return json({ error: 'Media not found.' }, 404)
    return new Response(bytes, {
      headers: {
        'content-type': contentType(filename),
        'cache-control': 'private, max-age=3600',
      },
    })
  }

  return json({ error: 'Not found.' }, 404)
}

export async function handleApiRequest(
  request: Request,
): Promise<Response | null> {
  try {
    return await api(request, new URL(request.url))
  } catch (error) {
    const unavailable = error instanceof AnkiUnavailableError
    const message = error instanceof Error ? error.message : 'Unexpected error.'
    return json(
      {
        error: message,
        code: unavailable ? 'ANKI_UNAVAILABLE' : 'REQUEST_FAILED',
      },
      unavailable ? 503 : 500,
    )
  }
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
