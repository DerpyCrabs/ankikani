import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/lib/api'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Anki API recovery', () => {
  it('retries safe reads once after a transient bridge error', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(
        { error: 'bridge busy', code: 'ANKI_UNAVAILABLE' },
        { status: 502 },
      ))
      .mockResolvedValueOnce(Response.json({
        deckName: 'German',
        modelNames: [],
        fieldsByModel: {},
        templatesByModel: {},
      }))

    const pending = api.profile('German')
    await vi.advanceTimersByTimeAsync(250)

    await expect(pending).resolves.toMatchObject({ deckName: 'German' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not automatically repeat a grading write', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { error: 'bridge busy', code: 'ANKI_UNAVAILABLE' },
        { status: 502 },
      ),
    )

    await expect(api.answer(10, 3, 'grade-10')).rejects.toThrow('bridge busy')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
