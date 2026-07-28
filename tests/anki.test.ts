import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AnkiUnavailableError,
  ankiInvoke,
  ankiMulti,
} from '../server/anki'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AnkiConnect bridge', () => {
  it('sends API version 6 and returns result', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        action: string
        version: number
      }
      expect(body).toMatchObject({ action: 'deckNames', version: 6 })
      return Response.json({ result: ['German'], error: null })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(ankiInvoke<string[]>('deckNames')).resolves.toEqual(['German'])
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('builds multi action payloads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          action: string
          params: { actions: unknown[] }
        }
        expect(body.action).toBe('multi')
        expect(body.params.actions).toHaveLength(2)
        return Response.json({ result: [6, ['German']], error: null })
      }),
    )

    await expect(
      ankiMulti<[number, string[]]>([
        { action: 'version' },
        { action: 'deckNames' },
      ]),
    ).resolves.toEqual([6, ['German']])
  })

  it('surfaces AnkiConnect API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ result: null, error: 'bad query' })),
    )
    await expect(ankiInvoke('findCards')).rejects.toThrow('bad query')
  })

  it('uses a dedicated unavailable error for network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('connection refused')
      }),
    )
    await expect(ankiInvoke('version')).rejects.toBeInstanceOf(
      AnkiUnavailableError,
    )
  })
})
