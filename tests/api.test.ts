import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/lib/api'
import { queryCache } from '@effectweb/query'
import { Effect } from 'effect'
import { deckProfile } from '../src/lib/resources'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Anki API recovery', () => {
  it('leaves retry policy to the query client', async () => {
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

    await expect(Effect.runPromise(api.profile('German'))).rejects.toThrow('bridge busy')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries transient reads through the query client', async () => {
    const fetchMock = vi.spyOn(globalThis,'fetch')
      .mockResolvedValueOnce(Response.json({error:'bridge busy',code:'ANKI_UNAVAILABLE'},{status:502}))
      .mockResolvedValueOnce(Response.json({deckName:'German',modelNames:[],fieldsByModel:{},templatesByModel:{}}))
    const client = queryCache()
    const pending = Effect.runPromise(client.prefetch(deckProfile, 'German'))
    await expect(pending).resolves.toMatchObject({deckName:'German'})
    expect(fetchMock).toHaveBeenCalledTimes(2)
    client.dispose()
  })

  it('aborts the underlying request when a query is cancelled', async () => {
    let requestSignal:AbortSignal|undefined
    vi.spyOn(globalThis,'fetch').mockImplementation((_input,init) => {
      requestSignal=init?.signal as AbortSignal
      return new Promise((_resolve,reject) => requestSignal.addEventListener('abort',()=>reject(requestSignal?.reason),{once:true}))
    })
    const client=queryCache()
    const pending=Effect.runPromise(client.prefetch(deckProfile, 'German'))
    await vi.waitFor(() => expect(requestSignal).toBeDefined())
    const rejected = expect(pending).rejects.toBeTruthy()
    client.cancelQuery(deckProfile, 'German')
    expect(requestSignal?.aborted).toBe(true)
    await rejected
    client.dispose()
  })

  it('does not automatically repeat a grading write', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { error: 'bridge busy', code: 'ANKI_UNAVAILABLE' },
        { status: 502 },
      ),
    )

    await expect(Effect.runPromise(api.answer(10, 3, 'grade-10'))).rejects.toThrow('bridge busy')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
