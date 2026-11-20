import { Effect, Schedule } from 'effect'
import { query, type QueryCache } from '@effectweb/query'
import { loadCards } from './cards'
import { api, ApiError } from './api'
import type { SchedulingSettings, StudyConfig } from './domain'

function readRequest<A>(request: Effect.Effect<A, Error>) {
  return request.pipe(
    Effect.retry({
      times: 1,
      schedule: Schedule.spaced(250),
      while: (error) => {
        if (!(error instanceof ApiError)) return false
        return (
          error.code === 'NETWORK' || error.code === 'TIMEOUT' || [502, 503, 504].includes(error.status ?? 0)
        )
      },
    }),
  )
}

export const scheduledCards = query({
  name: 'cards',
  staleTime: 15_000,
  load: ({ deck, ids, config }: { deck: string; ids: number[]; config: StudyConfig }) =>
    readRequest(loadCards(deck, ids, config)),
})

export const deckSettings = query({
  name: 'settings',
  staleTime: 15_000,
  load: (deck: string) => readRequest(api.settings(deck)),
})

export const collectionBackups = query({
  name: 'backups',
  staleTime: 15_000,
  load: () => readRequest(api.backups()),
})

type QueueArgs = { deck: string; config: StudyConfig }

export const lessonQueue = query({
  name: 'lessons',
  staleTime: 0,
  load: ({ deck, config }: QueueArgs) => readRequest(api.lessons(deck, config)),
})

export const reviewQueue = query({
  name: 'reviews',
  staleTime: 0,
  load: ({ deck, config }: QueueArgs) => readRequest(api.reviews(deck, config)),
})

export const healthCheck = query({
  name: 'health',
  staleTime: 0,
  load: () => readRequest(api.health()),
})
export const deckList = query({
  name: 'decks',
  staleTime: 0,
  load: () => readRequest(api.decks()),
})
export const deckProfile = query({
  name: 'profile',
  staleTime: 15_000,
  load: (deck: string) => readRequest(api.profile(deck)),
})
export const dashboardData = query({
  name: 'dashboard',
  staleTime: 15_000,
  load: ({ deck, config }: QueueArgs) => readRequest(api.dashboard(deck, config)),
})

export function saveDeckSettings(cache: QueryCache, deck: string, settings: SchedulingSettings) {
  return api
    .updateSettings(deck, settings)
    .pipe(Effect.tap((saved) => Effect.sync(() => cache.setQueryData(deckSettings, deck, saved))))
}
