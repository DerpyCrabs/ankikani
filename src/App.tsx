import {
  Match,
  Show,
  Switch,
  batch,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js'
import { api } from './lib/api'
import { configFromLegacy, reconcileConfig } from './lib/adapters'
import {
  configStorageKey,
  deckStorageId,
  profileKey,
} from './lib/storage'
import type {
  DeckConfig,
  DeckProfile,
  DeckSummary,
} from './lib/domain'

import { ConnectionScreen, DeckLoading, EmptyDeck, Header } from './components/AppShell'
import { Dashboard } from './components/Dashboard'
import { DeckSetup } from './components/DeckSetup'
import { LessonSession, ReviewSession } from './components/StudySessions'

type View = 'dashboard' | 'mapping' | 'lesson' | 'review'

const CONFIG_VERSION = 2
const VIEW_PATHS: Record<View, string> = {
  dashboard: '/',
  mapping: '/fields',
  lesson: '/lessons',
  review: '/reviews',
}

function viewFromPath(pathname: string): View {
  if (pathname === '/reviews') return 'review'
  if (pathname === '/lessons') return 'lesson'
  if (pathname === '/fields') return 'mapping'
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

function App() {
  const [connected, setConnected] = createSignal<boolean | null>(null)
  const [connectionError, setConnectionError] = createSignal('')
  const [decks, setDecks] = createSignal<DeckSummary[]>([])
  const [profileName, setProfileName] = createSignal('')
  const [deckName, setDeckName] = createSignal('')
  const [storageId, setStorageId] = createSignal('')
  const [profile, setProfile] = createSignal<DeckProfile | null>(null)
  const [configuration, setConfiguration] = createSignal<DeckConfig | null>(null)
  const [view, setView] = createSignal<View>(viewFromPath(window.location.pathname))
  let connectRequest = 0
  let configureRequest = 0
  let profileSyncRequest = 0
  const [dashboard, { refetch: refetchDashboard }] = createResource(
    () => {
      if (view() !== 'dashboard') return null
      const deck = deckName()
      const config = configuration()
      return deck && config?.deckName === deck ? { deck, config } : null
    },
    ({ deck, config }) => api.dashboard(deck, config),
  )

  async function connect(
    silent = false,
    knownHealth?: Awaited<ReturnType<typeof api.health>>,
  ) {
    const request = ++connectRequest
    if (!silent) setConnected(null)
    setConnectionError('')
    try {
      const health = knownHealth ?? await api.health()
      const availableDecks = await api.decks()
      if (request !== connectRequest) return
      const activeProfile = health.profileName || 'Default'
      const sameProfile = profileName() === activeProfile
      const changedLoadedProfile = Boolean(profileName()) && !sameProfile
      if (!sameProfile) {
        configureRequest += 1
      }
      let selected = sameProfile
        ? deckName()
        : localStorage.getItem(profileKey(activeProfile)) ?? ''
      if (!availableDecks.some((deck) => deck.name === selected)) {
        selected =
          availableDecks.find((deck) => deck.name !== 'Default')?.name ??
          availableDecks[0]?.name ??
          ''
      }
      batch(() => {
        if (!sameProfile) {
          setProfile(null)
          setConfiguration(null)
          setStorageId('')
        }
        setDecks(availableDecks)
        setProfileName(activeProfile)
        setDeckName(selected)
        setConnected(true)
      })
      if (changedLoadedProfile) navigate('dashboard')
    } catch (error) {
      if (request !== connectRequest) return
      if (silent) return
      setConnected(false)
      setConnectionError(
        error instanceof Error ? error.message : 'Could not connect to Anki.',
      )
    }
  }

  async function configureDeck(selectedDeck: string) {
    if (!selectedDeck) return
    const request = ++configureRequest
    const activeProfile = profileName()
    setConnectionError('')
    localStorage.setItem(profileKey(activeProfile), selectedDeck)
    setProfile(null)
    setConfiguration(null)
    setStorageId('')
    try {
      const nextProfile = await api.profile(selectedDeck)
      if (request !== configureRequest || profileName() !== activeProfile) return
      const nextStorageId = deckStorageId(activeProfile, nextProfile)
      setProfile(nextProfile)
      setStorageId(nextStorageId)
      const stored = loadConfig(selectedDeck, nextStorageId)
      const suggested =
        nextProfile.suggestedConfig ??
        (nextProfile.suggestedMapping
          ? configFromLegacy(selectedDeck, nextProfile.suggestedMapping)
          : null)
      const nextConfig = reconcileConfig(stored, suggested)
      if (nextConfig) {
        setConfiguration(nextConfig)
        if (!stored || JSON.stringify(stored) !== JSON.stringify(nextConfig)) {
          localStorage.setItem(
            configStorageKey(nextStorageId),
            JSON.stringify(nextConfig),
          )
        }
      } else if (nextProfile.modelNames.length) {
        navigate('mapping', true)
      }
    } catch (error) {
      if (request !== configureRequest || profileName() !== activeProfile) return
      setConnectionError(
        error instanceof Error ? error.message : 'Could not read deck profile.',
      )
    }
  }

  function selectDeck(name: string) {
    if (name === deckName()) return
    setDeckName(name)
    navigate('dashboard')
  }

  function navigate(nextView: View, replace = false) {
    const path = VIEW_PATHS[nextView]
    if (window.location.pathname !== path) {
      window.history[replace ? 'replaceState' : 'pushState']({}, '', path)
    }
    setView(nextView)
  }

  function saveConfiguration(nextConfig: DeckConfig) {
    const customized = { ...nextConfig, customized: true }
    localStorage.setItem(
      configStorageKey(storageId()),
      JSON.stringify(customized),
    )
    setConfiguration(customized)
    navigate('dashboard')
  }

  createEffect(() => {
    if (connected() && deckName()) void configureDeck(deckName())
  })

  onMount(() => {
    const onPopState = () => setView(viewFromPath(window.location.pathname))
    const syncActiveProfile = async () => {
      if (connected() !== true) return
      const request = ++profileSyncRequest
      try {
        const health = await api.health()
        if (request !== profileSyncRequest) return
        const activeProfile = health.profileName || 'Default'
        if (activeProfile !== profileName()) {
          await connect(true, health)
        }
      } catch {
        // Keep current screen during transient AnkiConnect failures.
      }
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void syncActiveProfile()
    }
    window.addEventListener('popstate', onPopState)
    window.addEventListener('focus', syncActiveProfile)
    document.addEventListener('visibilitychange', onVisibilityChange)
    onCleanup(() => {
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('focus', syncActiveProfile)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    })
    void connect()
  })

  return (
    <div class="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <Show when={connected() === true} fallback={<ConnectionScreen connected={connected()} error={connectionError()} retry={connect} />}>
        <Header
          decks={decks()}
          selected={deckName()}
          onSelect={selectDeck}
          onDashboard={() => navigate('dashboard')}
        />

        <main class="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-7 sm:px-6 lg:px-10">
          <Show
            when={profile()}
            fallback={
              <DeckLoading
                error={connectionError()}
                retry={() => void configureDeck(deckName())}
              />
            }
          >
            <Show
              when={profile()!.modelNames.length}
              fallback={<EmptyDeck deckName={deckName()} />}
            >
              <Switch>
                <Match when={view() === 'mapping' && profile()}>
                  <DeckSetup
                    profile={profile()!}
                    existing={configuration()}
                    onSave={saveConfiguration}
                    onCancel={configuration() ? () => navigate('dashboard') : undefined}
                  />
                </Match>
                <Match when={view() === 'lesson' && configuration() && storageId()}>
                  <LessonSession
                    deckName={deckName()}
                    storageId={storageId()}
                    configuration={configuration()!}
                    onExit={() => {
                      navigate('dashboard')
                    }}
                  />
                </Match>
                <Match when={view() === 'review' && configuration() && storageId()}>
                  <ReviewSession
                    deckName={deckName()}
                    storageId={storageId()}
                    configuration={configuration()!}
                    onExit={() => {
                      navigate('dashboard')
                    }}
                  />
                </Match>
                <Match when={configuration()}>
                  <Dashboard
                    data={dashboard()}
                    loading={dashboard.loading}
                    error={dashboard.error}
                    deckName={deckName()}
                    configuration={configuration()!}
                    onLessons={() => navigate('lesson')}
                    onReviews={() => navigate('review')}
                    onConfigure={() => navigate('mapping')}
                    onRetry={() => void refetchDashboard()}
                  />
                </Match>
                <Match when={!configuration() && profile()}>
                  <DeckSetup
                    profile={profile()!}
                    existing={null}
                    onSave={saveConfiguration}
                  />
                </Match>
              </Switch>
            </Show>
          </Show>
        </main>
      </Show>
    </div>
  )
}

export default App
