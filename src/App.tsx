import { Effect } from 'effect'
import { available, component, observe, resourceError, view } from 'effectweb'
import { queryCache, querySource } from '@effectweb/query'
import { healthCheck, deckList, deckProfile, dashboardData } from './lib/resources'
import { api } from './lib/api'
import { configFromLegacy, reconcileConfig } from './lib/adapters'
import { configStorageKey, deckStorageId, profileKey } from './lib/storage'
import type { DeckConfig, DeckProfile, DeckSummary } from './lib/domain'

import { ConnectionScreen, DeckLoading, EmptyDeck, Header } from './components/AppShell'
import { Dashboard } from './components/Dashboard'
import { DeckSetup } from './components/DeckSetup'
import { LessonSession, ReviewSession } from './components/StudySessions'
import { SchedulingSetup } from './components/SchedulingSetup'

type View = 'dashboard' | 'mapping' | 'settings' | 'lesson' | 'review'

const CONFIG_VERSION = 2
const VIEW_PATHS: Record<View, string> = {
  dashboard: '/',
  mapping: '/fields',
  settings: '/settings',
  lesson: '/lessons',
  review: '/reviews',
}

function viewFromPath(pathname: string): View {
  if (pathname === '/reviews') return 'review'
  if (pathname === '/lessons') return 'lesson'
  if (pathname === '/fields') return 'mapping'
  if (pathname === '/settings') return 'settings'
  return 'dashboard'
}

function loadConfig(deck: string, storageId: string): DeckConfig | null {
  try {
    const stored = localStorage.getItem(configStorageKey(storageId))
    if (stored) {
      const parsed = JSON.parse(stored) as DeckConfig
      if (parsed.version === CONFIG_VERSION && parsed.deckName === deck) return parsed
    }
    return null
  } catch {
    return null
  }
}

function initialState() {
  return {
    connected: null as boolean | null,
    error: '',
    decks: [] as DeckSummary[],
    profileName: '',
    deckName: '',
    storageId: '',
    profile: null as DeckProfile | null,
    configuration: null as DeckConfig | null,
    screen: viewFromPath(window.location.pathname),
  }
}

export default component({ init: initialState }, (owner) => {
  const cache = owner.own(queryCache({ unused: 'cancel' }))

  function navigate(screen: View, replace = false) {
    const path = VIEW_PATHS[screen]
    if (window.location.pathname !== path)
      window.history[replace ? 'replaceState' : 'pushState']({}, '', path)
    owner.patch({ screen })
  }

  function configure(deck: string) {
    const { profileName } = owner.read()
    localStorage.setItem(profileKey(profileName), deck)
    owner.patch({ deckName: deck, profile: null, configuration: null, storageId: '', error: '' })
    owner.run(
      'configure',
      cache.prefetch(deckProfile, deck).pipe(
        Effect.match({
          onFailure: (error) => owner.patch({ error: error.message }),
          onSuccess: (profile) => {
            const storageId = deckStorageId(profileName, profile)
            const stored = loadConfig(deck, storageId)
            const suggested =
              profile.suggestedConfig ??
              (profile.suggestedMapping ? configFromLegacy(deck, profile.suggestedMapping) : null)
            const configuration = reconcileConfig(stored, suggested)
            if (configuration && JSON.stringify(configuration) !== JSON.stringify(stored)) {
              localStorage.setItem(configStorageKey(storageId), JSON.stringify(configuration))
            }
            owner.patch({ profile, storageId, configuration })
            if (!configuration && profile.modelNames.length) navigate('mapping', true)
          },
        }),
      ),
      'replace',
    )
  }

  function connect(silent = false, knownHealth?: Effect.Success<ReturnType<typeof api.health>>) {
    if (!silent) owner.patch({ connected: null, error: '' })
    owner.run(
      'connect',
      Effect.gen(function* () {
        const health = knownHealth ?? (yield* cache.prefetch(healthCheck, true, { refresh: true }))
        const decks = yield* cache.prefetch(deckList, true, { refresh: true })
        if (!health) return yield* Effect.fail(new Error('Health check returned no data.'))
        const profileName = health.profileName || 'Default'
        const old = owner.read()
        const changed = old.profileName !== profileName
        if (changed) {
          owner.cancel('configure')
          cache.resetResources()
        }
        const previous = changed ? localStorage.getItem(profileKey(profileName)) : old.deckName
        const deckName =
          decks.find((deck) => deck.name === previous)?.name ??
          decks.find((deck) => deck.name !== 'Default')?.name ??
          decks[0]?.name ??
          ''
        if (changed && old.profileName) navigate('dashboard')
        owner.patch({
          profileName,
          decks,
          deckName,
          connected: true,
          error: '',
          ...(changed ? { configuration: null, profile: null, storageId: '' } : {}),
        })
        if (deckName && (changed || old.deckName !== deckName || !old.profile)) configure(deckName)
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            if (!silent) owner.patch({ connected: false, error: error.message })
          }),
        ),
      ),
      'replace',
    )
  }

  function syncProfile() {
    if (!owner.read().connected) return
    owner.run(
      'sync-profile',
      cache.prefetch(healthCheck, true, { refresh: true }).pipe(
        Effect.tap((health) =>
          Effect.sync(() => {
            if ((health.profileName || 'Default') !== owner.read().profileName) connect(true, health)
          }),
        ),
        Effect.ignore,
      ),
      'replace',
    )
  }
  const onPop = () => owner.patch({ screen: viewFromPath(window.location.pathname) })
  const refreshVisibleDashboard = () => {
    const { screen, connected, deckName, configuration } = owner.read()
    if (document.visibilityState === 'visible' && screen === 'dashboard' && connected && configuration) {
      cache.invalidateQuery(dashboardData, { deck: deckName, config: configuration })
    }
  }
  let dashboardTimer: number | undefined
  const scheduleDashboardRefresh = () => {
    window.clearInterval(dashboardTimer)
    if (document.visibilityState === 'visible') {
      dashboardTimer = window.setInterval(refreshVisibleDashboard, 60_000)
    }
  }
  const onVisible = () => {
    scheduleDashboardRefresh()
    if (document.visibilityState === 'visible') {
      syncProfile()
      refreshVisibleDashboard()
    }
  }
  scheduleDashboardRefresh()
  window.addEventListener('popstate', onPop)
  window.addEventListener('focus', syncProfile)
  document.addEventListener('visibilitychange', onVisible)
  owner.own(() => {
    window.clearInterval(dashboardTimer)
    window.removeEventListener('popstate', onPop)
    window.removeEventListener('focus', syncProfile)
    document.removeEventListener('visibilitychange', onVisible)
  })
  connect()

  function saveConfig(next: DeckConfig) {
    const configuration = { ...next, customized: true }
    localStorage.setItem(configStorageKey(owner.read().storageId), JSON.stringify(configuration))
    owner.patch({ configuration })
    navigate('dashboard')
  }

  return view((model) => {
    const { connected, decks, error, deckName, profile, configuration, screen, storageId } = model
    const home = () => navigate('dashboard')
    function content() {
      if (!profile) return <DeckLoading error={error} retry={() => configure(deckName)} />
      if (!profile.modelNames.length) return <EmptyDeck deckName={deckName} />
      if (screen === 'mapping' || (!configuration && screen !== 'settings')) {
        return (
          <DeckSetup
            profile={profile}
            existing={configuration}
            onSave={saveConfig}
            onCancel={configuration ? home : undefined}
          />
        )
      }
      const args = { deck: deckName, config: configuration! }
      const refresh = () => cache.invalidateQuery(dashboardData, args)
      if (screen === 'settings')
        return (
          <SchedulingSetup
            cache={cache}
            deckName={deckName}
            onConfigure={() => navigate('mapping')}
            onSaved={() => {
              refresh()
              home()
            }}
            onClose={home}
          />
        )
      const session = {
        cache,
        deckName,
        configuration: configuration!,
        storageId,
        onGraded: refresh,
        onExit: home,
      }
      if (screen === 'lesson') return <LessonSession {...session} />
      if (screen === 'review') return <ReviewSession {...session} />
      return observe(querySource(cache, dashboardData, args), (result) => (
        <Dashboard
          cache={cache}
          data={available(result)}
          loading={!available(result) && !resourceError(result)}
          error={resourceError(result)}
          deckName={deckName}
          configuration={configuration!}
          onLessons={() => navigate('lesson')}
          onReviews={() => navigate('review')}
          onScheduling={() => navigate('settings')}
          onRetry={refresh}
        />
      ))
    }
    return (
      <div class="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
        {connected ? (
          <>
            <Header
              decks={decks}
              selected={deckName}
              onDashboard={home}
              onSelect={(deck) => {
                if (deck !== deckName) {
                  home()
                  configure(deck)
                }
              }}
            />
            <main class="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-7 sm:px-6 lg:px-10">{content()}</main>
          </>
        ) : (
          <ConnectionScreen connected={connected} error={error} retry={() => connect()} />
        )}
      </div>
    )
  })
})
