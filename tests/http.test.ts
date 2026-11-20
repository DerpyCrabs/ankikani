import { describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'
import { AnkiUnavailableError } from '../server/anki'
import { handleApiRequest } from '../server'

const health = vi.hoisted(() => vi.fn())
vi.mock('../server/provider', () => ({ providerHealth: health }))
vi.mock('../server/package-import', () => ({}))
vi.mock('../server/collection-import', () => ({}))

const send = (path: string, init?: RequestInit) =>
  handleApiRequest(new Request('http://localhost' + path, init))

describe('HTTP API contract', () => {
  it('returns 503 and the bridge error code when Anki is offline', async () => {
    health.mockReturnValueOnce(Effect.fail(new AnkiUnavailableError('Offline')))
    const response = await send('/api/health')
    expect(response?.status).toBe(503)
    expect(await response?.json()).toEqual({ code: 'ANKI_UNAVAILABLE', error: 'Offline' })
  })

  it('leaves frontend routes to the static handler', async () => {
    expect(await send('/review')).toBeNull()
  })

  it.each([
    ['/api/settings', 400, 'Missing deck.'],
    ['/api/missing', 404, 'Not found.'],
  ] as const)('returns an uncached JSON error for %s', async (path, status, error) => {
    const response = await send(path)
    expect(response?.status).toBe(status)
    expect(response?.headers.get('cache-control')).toBe('no-store')
    expect(await response?.json()).toEqual({ error })
  })

  it('rejects an invalid grade before changing a card', async () => {
    const response = await send('/api/answer', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cardId: 1, ease: 4 }),
    })
    expect(response?.status).toBe(400)
    expect(await response?.json()).toEqual({ error: 'Only Again (1) and Good (3) are allowed.' })
  })

  it('preserves the error envelope for invalid request bodies', async () => {
    const response = await send('/api/dashboard', { method: 'POST', body: 'invalid' })
    expect(response?.status).toBe(500)
    expect(await response?.json()).toEqual({ error: 'Expected application/json request.', code: 'REQUEST_FAILED' })
  })
})
