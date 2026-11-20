import { afterEach, expect, it, vi } from 'vitest'
import { createAppQueryClient, mutations, queries } from '../src/lib/query'
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
  const client = createAppQueryClient()
  try {
    const original = await client.fetchQuery(queries.settings('German'))
    expect(original.reviewsPerDay).toBe(200)
    const saved = { ...original, reviewsPerDay: 50 }
    // Execute through the real mutation cache so onSuccess runs as it does in the form.
    const mutation = client.getMutationCache().build(client, mutations.updateSettings(client, 'German'))
    await mutation.execute(saved)
    expect(serverSettings.reviewsPerDay).toBe(50)
    const reopened = await client.fetchQuery(queries.settings('German'))
    expect(reopened).toEqual(saved)
  } finally {
    client.clear()
  }
})
