import { afterEach, expect, it, vi } from 'vitest'
import { queryCache } from '@effectweb/query'
import { Effect } from 'effect'
import { deckSettings, saveDeckSettings } from '../src/lib/resources'
import type { SchedulingSettings } from '../src/lib/domain'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('reopens settings with the saved values inside the query freshness window', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
  let serverSettings: SchedulingSettings = {
    newPerDay: 20, reviewsPerDay: 200, desiredRetention: 0.9, maximumInterval: 36500,
    learningSteps: ['1m', '10m'], relearningSteps: ['10m'], leechThreshold: 8, burySiblings: true,
  }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (url === '/api/settings?deck=German' && !init?.method) return Response.json(serverSettings)
    if (url === '/api/settings' && init?.method === 'PUT') {
      const payload = JSON.parse(String(init.body)) as { deck: string; settings: SchedulingSettings }
      expect(payload.deck).toBe('German')
      serverSettings = payload.settings
      return Response.json(serverSettings)
    }
    throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${String(url)}`)
  })
  const client = queryCache()
  try {
    const original = await Effect.runPromise(client.prefetch(deckSettings, 'German'))
    expect(original.reviewsPerDay).toBe(200)
    const saved = { ...original, reviewsPerDay: 50 }
    await Effect.runPromise(saveDeckSettings(client, 'German', saved))
    expect(serverSettings.reviewsPerDay).toBe(50)
    const reopened = await Effect.runPromise(client.prefetch(deckSettings, 'German'))
    expect(reopened).toEqual(saved)
  } finally {
    client.dispose()
  }
})
