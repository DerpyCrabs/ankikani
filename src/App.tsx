import BookOpen from 'lucide-solid/icons/book-open'
import Brain from 'lucide-solid/icons/brain'
import Check from 'lucide-solid/icons/check'
import ChevronRight from 'lucide-solid/icons/chevron-right'
import CircleAlert from 'lucide-solid/icons/circle-alert'
import Flame from 'lucide-solid/icons/flame'
import Headphones from 'lucide-solid/icons/headphones'
import LoaderCircle from 'lucide-solid/icons/loader-circle'
import RefreshCw from 'lucide-solid/icons/refresh-cw'
import Settings2 from 'lucide-solid/icons/settings-2'
import Sparkles from 'lucide-solid/icons/sparkles'
import Volume2 from 'lucide-solid/icons/volume-2'
import X from 'lucide-solid/icons/x'
import {
  For,
  Match,
  Show,
  Switch,
  batch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js'
import { api } from './lib/api'
import {
  matchesAnswerPart,
  splitGermanArticle,
  type GermanGenderArticle,
} from './lib/answers'
import {
  adaptCard,
  configFromLegacy,
  reconcileConfig,
} from './lib/adapters'
import {
  configStorageKey,
  deckStorageId,
  profileKey,
  sessionStorageKey,
} from './lib/storage'
import type {
  AnswerLanguage,
  AnswerMode,
  AnswerPart,
  DashboardData,
  DeckConfig,
  DeckProfile,
  DeckSummary,
  ForecastDay,
  LessonItem,
  ModelConfig,
  StudyConfig,
  StudyCard,
} from './lib/domain'

type View = 'dashboard' | 'mapping' | 'lesson' | 'review'
type StudyPhase = 'answering' | 'correction' | 'feedback'

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

async function loadCards(
  deckName: string,
  cardIds: number[],
  configuration: StudyConfig,
): Promise<StudyCard[]> {
  const cards: StudyCard[] = []
  for (let offset = 0; offset < cardIds.length; offset += 500) {
    cards.push(
      ...(await api.cards(
        deckName,
        cardIds.slice(offset, offset + 500),
        configuration,
      )),
    )
  }
  return cards
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
    setDeckName(name)
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

function Header(props: {
  decks: DeckSummary[]
  selected: string
  onSelect: (name: string) => void
  onDashboard: () => void
}) {
  return (
    <header class="sticky top-0 z-40 border-b border-black/8 bg-[color:var(--paper)]/92 backdrop-blur-xl">
      <div class="mx-auto flex h-18 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
        <button
          class="group flex items-center gap-3 rounded-xl text-left focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[var(--violet)]"
          onClick={props.onDashboard}
          aria-label="Open dashboard"
        >
          <span class="grid size-10 rotate-[-3deg] place-items-center rounded-[14px] bg-[var(--coral)] text-xl font-black text-white shadow-[0_4px_0_var(--coral-dark)] transition-transform group-hover:rotate-0">
            A
          </span>
          <span>
            <span class="block text-[1.08rem] font-black tracking-[-0.03em]">
              AnkiKani
            </span>
          </span>
        </button>

        <label class="relative min-w-0 max-w-[380px] flex-1 sm:flex-initial">
          <span class="sr-only">Active deck</span>
          <select
            class="h-11 w-full appearance-none truncate rounded-xl border border-black/10 bg-white py-2 pl-4 pr-10 text-sm font-bold shadow-sm outline-none transition focus:border-[var(--violet)] focus:ring-3 focus:ring-[color:var(--violet)]/15 sm:min-w-72"
            value={props.selected}
            onChange={(event) => props.onSelect(event.currentTarget.value)}
          >
            <For each={props.decks}>
              {(deck) => (
                <option value={deck.name}>
                  {deck.name}{deck.subdeckCount ? ` (+${deck.subdeckCount} subdecks)` : ''}
                </option>
              )}
            </For>
          </select>
        </label>
      </div>
    </header>
  )
}

function ConnectionScreen(props: {
  connected: boolean | null
  error: string
  retry: () => Promise<void>
}) {
  return (
    <main class="grid min-h-screen place-items-center px-5">
      <section class="card-shell w-full max-w-lg p-7 sm:p-10">
        <div class="mb-7 grid size-14 place-items-center rounded-2xl bg-[var(--yellow-soft)]">
          <Show
            when={props.connected !== null}
            fallback={<LoaderCircle class="size-7 animate-spin" />}
          >
            <CircleAlert class="size-7" />
          </Show>
        </div>
        <h1 class="text-3xl font-black tracking-[-0.04em]">
          {props.connected === null ? 'Finding Anki…' : 'Anki is out of reach'}
        </h1>
        <p class="mt-3 leading-7 text-[var(--muted)]">
          {props.connected === null
            ? 'Checking the local AnkiConnect bridge.'
            : props.error ||
              'Start Anki Desktop and make sure AnkiConnect is enabled.'}
        </p>
        <Show when={props.connected === false}>
          <ol class="mt-6 space-y-2 border-l-2 border-[var(--yellow)] pl-5 text-sm font-semibold">
            <li>1. Open Anki Desktop on this computer.</li>
            <li>2. Keep AnkiConnect enabled.</li>
            <li>3. Retry this connection.</li>
          </ol>
          <button class="button-soft-primary mt-7 w-full" onClick={() => void props.retry()}>
            <RefreshCw class="size-4" />
            Retry connection
          </button>
        </Show>
      </section>
    </main>
  )
}

function EmptyDeck(props: { deckName: string }) {
  return (
    <section class="mx-auto mt-16 max-w-xl text-center">
      <div class="mx-auto grid size-20 place-items-center rounded-full bg-[var(--yellow)]/30">
        <BookOpen class="size-9" />
      </div>
      <h1 class="mt-6 text-3xl font-black">Nothing to study here yet</h1>
      <p class="mt-3 text-[var(--muted)]">
        <strong>{props.deckName}</strong> has no notes. Add or import cards in
        Anki Desktop, then return here.
      </p>
    </section>
  )
}

function DeckLoading(props: { error: string; retry: () => void }) {
  return (
    <section class="mx-auto mt-20 max-w-lg text-center">
      <Show
        when={props.error}
        fallback={<LoaderCircle class="mx-auto size-9 animate-spin text-[var(--violet)]" />}
      >
        <CircleAlert class="mx-auto size-9 text-[var(--coral)]" />
      </Show>
      <h1 class="mt-5 text-xl font-black">
        {props.error ? 'Could not read deck setup' : 'Reading deck setup…'}
      </h1>
      <Show when={props.error}>
        <p class="mt-3 text-sm text-[var(--muted)]">{props.error}</p>
        <button class="button-quiet mt-6" onClick={props.retry}>Retry</button>
      </Show>
    </section>
  )
}

function Dashboard(props: {
  data: DashboardData | undefined
  loading: boolean
  error: unknown
  deckName: string
  configuration: StudyConfig
  onLessons: () => void
  onReviews: () => void
  onConfigure: () => void
  onRetry: () => void
}) {
  const [selectedDay, setSelectedDay] = createSignal<ForecastDay | null>(null)

  return (
    <Show
      when={!props.loading && props.data}
      fallback={<DashboardSkeleton error={props.error} retry={props.onRetry} />}
    >
      {(data) => (
        <>
          <div class="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 class="max-w-3xl text-3xl font-black tracking-[-0.045em] sm:text-4xl">
                {props.deckName}
              </h1>
            </div>
            <button class="button-quiet" onClick={props.onConfigure}>
              <Settings2 class="size-4" />
              Fields
            </button>
          </div>

          <section class="grid gap-5 lg:grid-cols-12">
            <ActionCard
              kind="lesson"
              count={data().lessonsAvailable}
              title="Lessons"
              action="Start lessons"
              disabled={data().lessonsAvailable === 0}
              onClick={props.onLessons}
            />
            <ActionCard
              kind="review"
              count={data().reviewsDue}
              title="Reviews"
              action="Start reviews"
              disabled={data().reviewsDue === 0}
              onClick={props.onReviews}
            />
            <ForecastCard
              data={data()}
              onDay={(day) => setSelectedDay(day)}
            />
            <StreakCard data={data()} />
            <CompletedCard data={data()} />
            <SpreadCard data={data()} />
          </section>

          <Show when={selectedDay()}>
            {(day) => (
              <DueCardsDialog
                day={day()}
                deckName={props.deckName}
                configuration={props.configuration}
                onClose={() => setSelectedDay(null)}
              />
            )}
          </Show>
        </>
      )}
    </Show>
  )
}

function ActionCard(props: {
  kind: 'lesson' | 'review'
  count: number
  title: string
  action: string
  disabled: boolean
  onClick: () => void
}) {
  const lesson = props.kind === 'lesson'
  return (
    <article
      class={`card-shell relative overflow-hidden p-6 sm:p-7 lg:col-span-4 ${
        lesson ? 'bg-[var(--yellow-soft)]' : 'bg-[var(--mint-soft)]'
      }`}
    >
      <div
        class={`absolute -right-9 -top-10 size-34 rounded-full border-[18px] ${
          lesson ? 'border-[var(--yellow)]/35' : 'border-[var(--mint)]/30'
        }`}
      />
      <div class="relative">
        <div
          class={`mb-8 grid size-13 place-items-center rounded-2xl ${
            lesson
              ? 'bg-[var(--yellow)] text-[var(--ink)]'
              : 'bg-[var(--mint)] text-white'
          }`}
        >
          {lesson ? <Sparkles class="size-6" /> : <Brain class="size-6" />}
        </div>
        <div class="flex items-baseline gap-3">
          <h2 class="text-3xl font-black tracking-[-0.04em]">{props.title}</h2>
          <span class="rounded-full border border-black/15 bg-white/70 px-3 py-0.5 text-sm font-black">
            {props.count}
          </span>
        </div>
        <button
          class="button-ink mt-5 w-full"
          disabled={props.disabled}
          onClick={props.onClick}
        >
          {props.disabled ? `No ${props.title.toLowerCase()} now` : props.action}
          <ChevronRight class="size-4" />
        </button>
      </div>
    </article>
  )
}

function ForecastCard(props: {
  data: DashboardData
  onDay: (day: ForecastDay) => void
}) {
  const futureDays = () => props.data.forecast.slice(1)
  const max = () => Math.max(1, ...futureDays().map((day) => day.count))
  return (
    <article class="card-shell p-6 sm:p-7 lg:col-span-4">
      <div class="space-y-2">
        <For each={futureDays()}>
          {(day) => (
            <button
              class="group grid w-full grid-cols-[3.2rem_1fr_2.5rem] items-center gap-3 rounded-lg px-1 py-1.5 text-left focus-visible:outline-3 focus-visible:outline-[var(--violet)]"
              onClick={() => props.onDay(day)}
            >
              <span class="text-sm font-bold text-[var(--muted)]">{day.label}</span>
              <span class="h-2.5 overflow-hidden rounded-full bg-black/6">
                <span
                  class="block h-full rounded-full bg-[var(--violet)] transition-[width]"
                  style={{ width: `${Math.max(day.count ? 4 : 0, (day.count / max()) * 100)}%` }}
                />
              </span>
              <span class="flex items-center justify-end gap-1 text-sm font-black">
                {day.count}
                <ChevronRight class="size-3.5 text-[var(--muted)] transition-transform group-hover:translate-x-0.5" />
              </span>
            </button>
          )}
        </For>
      </div>
    </article>
  )
}

function StreakCard(props: { data: DashboardData }) {
  return (
    <article class="card-shell p-6 sm:p-7 lg:col-span-6">
      <div class="grid gap-7 sm:grid-cols-[auto_1fr] sm:items-center">
        <div class="grid size-24 place-items-center rounded-[32px] bg-[var(--coral-soft)] text-[var(--coral)]">
          <Flame class="size-11" fill="currentColor" stroke-width={1.5} />
        </div>
        <div>
          <strong class="text-5xl font-black tracking-[-0.06em]">
            {props.data.currentStreak}
          </strong>
          <p class="mt-1 text-lg font-bold">Day study streak</p>
          <p class="mt-3 text-sm font-semibold text-[var(--muted)]">
            Best streak: <span class="text-[var(--ink)]">{props.data.bestStreak} days</span>
          </p>
        </div>
      </div>
    </article>
  )
}

function CompletedCard(props: { data: DashboardData }) {
  return (
    <article class="card-shell p-6 sm:p-7 lg:col-span-6">
      <div class="grid gap-7 sm:grid-cols-[auto_1fr] sm:items-center">
        <div class="grid size-24 place-items-center rounded-[32px] bg-[var(--violet-soft)] text-[var(--violet)]">
          <Check class="size-11" stroke-width={2.5} />
        </div>
        <div>
          <strong class="text-5xl font-black tracking-[-0.06em]">
            {props.data.completedToday}
          </strong>
          <p class="mt-1 text-lg font-bold">Reviews completed today</p>
          <p class="mt-3 text-sm font-semibold text-[var(--muted)]">
            Yesterday: <span class="text-[var(--ink)]">{props.data.completedYesterday}</span>
          </p>
        </div>
      </div>
    </article>
  )
}

function SpreadCard(props: { data: DashboardData }) {
  const max = Math.max(1, ...props.data.activeSpread.map((stage) => stage.total))
  const plotHeight = 164
  const colors = [
    'var(--coral)',
    'var(--violet)',
    'var(--mint)',
    'var(--yellow)',
    '#3b82f6',
    '#ec4899',
  ]
  const colorFor = (key: string) => {
    const index = props.data.spreadLegend.findIndex((item) => item.key === key)
    return colors[Math.max(0, index) % colors.length]
  }
  return (
    <article class="card-shell min-w-0 p-6 sm:p-8 lg:col-span-12">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <h2 class="text-2xl font-black">Active item spread</h2>
        <div class="flex flex-wrap gap-4 text-xs font-bold text-[var(--muted)]">
          <For each={props.data.spreadLegend}>
            {(item) => <Legend color={colorFor(item.key)} label={item.label} />}
          </For>
        </div>
      </div>
      <div class="mt-7 overflow-x-auto pb-1">
        <div class="min-w-[680px]">
          <div class="relative h-52 border-b border-black/14">
            <div class="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-black/7" />
            <div class="pointer-events-none absolute inset-x-0 top-1/4 border-t border-dashed border-black/7" />
            <div class="pointer-events-none absolute inset-x-0 top-2/4 border-t border-dashed border-black/7" />
            <div class="pointer-events-none absolute inset-x-0 top-3/4 border-t border-dashed border-black/7" />
            <div
              class="absolute inset-0 grid grid-cols-8 items-end gap-4 px-2"
              role="img"
              aria-label="Vocabulary maturity distribution"
            >
              <For each={props.data.activeSpread}>
                {(stage) => {
                  const totalHeight = Math.max(
                    stage.total ? 5 : 0,
                    (stage.total / max) * plotHeight,
                  )
                  return (
                    <div class="flex h-full min-w-0 flex-col items-center justify-end">
                      <span class="mb-1.5 text-xs font-black tabular-nums">
                        {stage.total}
                      </span>
                      <div
                        class="flex w-full max-w-20 flex-col-reverse overflow-hidden rounded-t-md"
                        style={{ height: `${totalHeight}px` }}
                        title={`${stage.label}: ${stage.total} notes`}
                      >
                        <For each={props.data.spreadLegend}>
                          {(item) => (
                            <SpreadSegment
                              count={stage.segments[item.key] ?? 0}
                              total={stage.total}
                              color={colorFor(item.key)}
                            />
                          )}
                        </For>
                      </div>
                    </div>
                  )
                }}
              </For>
            </div>
          </div>
          <div class="grid grid-cols-8 gap-4 px-2 pt-3">
            <For each={props.data.activeSpread}>
              {(stage) => (
                <span class="text-center text-xs font-bold leading-4 text-[var(--muted)]">
                  {stage.label}
                </span>
              )}
            </For>
          </div>
        </div>
      </div>
    </article>
  )
}

function Legend(props: { color: string; label: string }) {
  return (
    <span class="flex items-center gap-1.5">
      <span class="size-2.5 rounded-full" style={{ background: props.color }} />
      {props.label}
    </span>
  )
}

function SpreadSegment(props: { count: number; total: number; color: string }) {
  return (
    <Show when={props.count}>
      <span
        class="block w-full"
        style={{
          height: `${(props.count / Math.max(1, props.total)) * 100}%`,
          background: props.color,
        }}
      />
    </Show>
  )
}

function DashboardSkeleton(props: { error: unknown; retry: () => void }) {
  return (
    <Show
      when={!props.error}
      fallback={
        <section class="card-shell mx-auto mt-16 max-w-xl p-8 text-center">
          <CircleAlert class="mx-auto size-9 text-[var(--coral)]" />
          <h2 class="mt-4 text-2xl font-black">Dashboard could not load</h2>
          <p class="mt-2 text-[var(--muted)]">
            {props.error instanceof Error ? props.error.message : 'Try again.'}
          </p>
          <button class="button-primary mt-6" onClick={props.retry}>Retry</button>
        </section>
      }
    >
      <div class="grid animate-pulse gap-5 lg:grid-cols-12">
        <For each={[4, 4, 4, 5, 7, 12]}>
          {(span) => <div class={`h-64 rounded-[24px] bg-black/6 lg:col-span-${span}`} />}
        </For>
      </div>
    </Show>
  )
}

function DueCardsDialog(props: {
  day: ForecastDay
  deckName: string
  configuration: StudyConfig
  onClose: () => void
}) {
  const [cards] = createResource(
    () => props.day.cardIds,
    (ids) => loadCards(props.deckName, ids, props.configuration),
  )

  onMount(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', close)
    onCleanup(() => window.removeEventListener('keydown', close))
  })

  return (
    <div
      class="fixed inset-0 z-50 grid place-items-end bg-[var(--ink)]/40 p-0 backdrop-blur-sm sm:place-items-center sm:p-5"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="due-title"
        class="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:rounded-[28px]"
      >
        <header class="flex items-center justify-between border-b border-black/8 px-6 py-5">
          <div>
            <p class="eyebrow">{props.day.date}</p>
            <h2 id="due-title" class="mt-1 text-xl font-black">
              {props.day.label} · {props.day.count} scheduled
            </h2>
          </div>
          <button class="icon-button" onClick={props.onClose} aria-label="Close">
            <X class="size-5" />
          </button>
        </header>
        <div class="max-h-[65vh] overflow-y-auto p-4 sm:p-6">
          <Show
            when={!cards.loading}
            fallback={<LoaderCircle class="mx-auto my-12 size-7 animate-spin" />}
          >
            <div class="space-y-2">
              <For each={cards()}>
                {(card) => (
                  <div class="flex items-center justify-between gap-4 rounded-xl bg-[var(--paper)] px-4 py-3">
                    <div class="min-w-0">
                      <p class="truncate font-black">{card.prompt}</p>
                      <p class="truncate text-sm text-[var(--muted)]">
                        {card.directionLabel}
                      </p>
                    </div>
                    <span class="shrink-0 text-sm font-bold text-[var(--muted)]">
                      {card.interval}d
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </section>
    </div>
  )
}

function DeckSetup(props: {
  profile: DeckProfile
  existing: DeckConfig | null
  onSave: (configuration: DeckConfig) => void
  onCancel?: () => void
}) {
  const fallback = (): DeckConfig => {
    if (props.profile.suggestedMapping) {
      return configFromLegacy(props.profile.deckName, props.profile.suggestedMapping)
    }
    return {
      version: 2,
      deckName: props.profile.deckName,
      includeSubdecks: true,
      models: props.profile.modelNames.map((modelName) => {
        const fields = props.profile.fieldsByModel[modelName] ?? []
        return {
          modelName,
          enabled: fields.length >= 2,
          kind: 'text',
          label: 'Typed recall',
          confidence: fields.length >= 2 ? 0.5 : 0,
          plans: [{
            ord: 0,
            kind: 'text',
            direction: 'forward',
            directionLabel: `${fields[0] ?? 'Prompt'} → ${fields[1] ?? 'Answer'}`,
            promptField: fields[0],
            answerFields: fields[1] ? [fields[1]] : [],
            answerLanguages: ['plain'],
          }],
        } satisfies ModelConfig
      }),
    }
  }
  const initial =
    props.existing ??
    props.profile.suggestedConfig ??
    fallback()
  const [models, setModels] = createSignal<ModelConfig[]>(
    structuredClone(initial.models),
  )
  const compatibility = (modelName: string) =>
    props.profile.compatibility?.find((item) => item.modelName === modelName)

  function updateModel(index: number, update: (model: ModelConfig) => void) {
    setModels((current) =>
      current.map((model, modelIndex) => {
        if (modelIndex !== index) return model
        const next = structuredClone(model)
        update(next)
        return next
      }),
    )
  }
  const [modelName, setModelName] = createSignal(models()[0]?.modelName ?? '')
  const [previewIndex, setPreviewIndex] = createSignal(0)
  const selectedIndex = createMemo(() =>
    Math.max(0, models().findIndex((model) => model.modelName === modelName())),
  )
  const selectedModel = createMemo(() => models()[selectedIndex()])
  const selectedReport = createMemo(() => compatibility(modelName()))
  createEffect(() => {
    modelName()
    setPreviewIndex(0)
  })
  const fields = createMemo(() => props.profile.fieldsByModel[modelName()] ?? [])
  const templateNames = createMemo(
    () => Object.keys(props.profile.templatesByModel[modelName()] ?? {}),
  )
  const previews = createMemo(() => {
    const selected = selectedModel()
    if (!selected) return []
    const configuration: DeckConfig = {
      version: 2,
      deckName: props.profile.deckName,
      includeSubdecks: true,
      models: [selected],
    }
    return (props.profile.samplesByModel?.[modelName()] ?? [])
      .map((card) => adaptCard(card, configuration))
      .filter((card): card is StudyCard => Boolean(card))
  })
  const preview = createMemo(() => previews()[previewIndex()] ?? previews()[0])
  const setupIssues = createMemo(() => {
    const issues = [
      ...(compatibility(modelName())?.diagnostics?.issues ?? []),
    ]
    const item = preview()
    if (!item) issues.push('No sample produces a usable typed answer.')
    if (item?.prompt && item.prompt === item.canonicalAnswer) {
      issues.push('Prompt and answer are identical.')
    }
    return [...new Set(issues)]
  })
  const firstPlan = createMemo(() => selectedModel()?.plans[0])
  const secondPlan = createMemo(() => selectedModel()?.plans[1] ?? firstPlan())
  const sourceWord = () => firstPlan()?.promptField ?? ''
  const targetMeaning = () => firstPlan()?.answerFields[0] ?? ''
  const additionalAnswer = () => firstPlan()?.answerFields[1] ?? ''
  const answerMode = () => firstPlan()?.answerMode ?? 'parts'
  const answerSeparators = () =>
    (firstPlan()?.answerSeparators ?? ['/', ';']).join('')
  const additionalOptional = () =>
    Boolean(
      additionalAnswer() &&
        firstPlan()?.optionalAnswerFields?.includes(additionalAnswer()),
    )
  const sourceLanguage = () => secondPlan()?.answerLanguages[0] ?? 'plain'
  const targetLanguage = () => firstPlan()?.answerLanguages[0] ?? 'plain'
  const sourceExample = () => firstPlan()?.sourceExampleField ?? ''
  const targetExample = () => firstPlan()?.targetExampleField ?? ''
  const note = () => firstPlan()?.noteField ?? ''
  const audio = () => firstPlan()?.audioField ?? ''
  const forwardOrd = () => firstPlan()?.ord ?? 0
  const reverseOrd = () => secondPlan()?.ord ?? 0
  const updatePlan = (planIndex: number, update: (plan: ModelConfig['plans'][number]) => void) =>
    updateModel(selectedIndex(), (model) => {
      const selected = model.plans[planIndex] ?? model.plans[0]
      if (selected) update(selected)
    })
  const setSourceWord = (value: string) =>
    updateModel(selectedIndex(), (model) => {
      model.plans.forEach((plan, index) => {
        if (index === 0) plan.promptField = value
        else plan.answerFields = [value]
      })
    })
  const setTargetMeaning = (value: string) =>
    updateModel(selectedIndex(), (model) => {
      model.plans.forEach((plan, index) => {
        if (index === 0) {
          plan.answerFields = [value, ...plan.answerFields.slice(1)]
        }
        else plan.promptField = value
      })
    })
  const setAdditionalAnswer = (value: string) =>
    updatePlan(0, (plan) => {
      plan.answerFields = value
        ? [plan.answerFields[0], value].filter(Boolean)
        : plan.answerFields.slice(0, 1)
      plan.answerLanguages = value
        ? [plan.answerLanguages[0] ?? 'plain', plan.answerLanguages[1] ?? 'plain']
        : plan.answerLanguages.slice(0, 1)
      plan.optionalAnswerFields = (plan.optionalAnswerFields ?? []).filter(
        (name) => name === value,
      )
    })
  const setAnswerMode = (value: AnswerMode) =>
    updatePlan(0, (plan) => { plan.answerMode = value })
  const setAnswerSeparators = (value: string) =>
    updatePlan(0, (plan) => {
      plan.answerSeparators = [...new Set([...value])].filter(
        (separator) => !/\s/u.test(separator),
      )
    })
  const setAdditionalOptional = (optional: boolean) =>
    updatePlan(0, (plan) => {
      const fieldName = plan.answerFields[1]
      plan.optionalAnswerFields =
        optional && fieldName ? [fieldName] : []
    })
  const setSourceLanguage = (value: AnswerLanguage) =>
    updateModel(selectedIndex(), (model) => {
      model.plans.slice(1).forEach((plan) => {
        plan.answerLanguages = [value]
      })
    })
  const setTargetLanguage = (value: AnswerLanguage) =>
    updatePlan(0, (plan) => { plan.answerLanguages = [value] })
  const setSourceExample = (value: string) =>
    updateModel(selectedIndex(), (model) => {
      model.plans.forEach((plan) => {
        plan.sourceExampleField = value || undefined
      })
    })
  const setTargetExample = (value: string) =>
    updateModel(selectedIndex(), (model) => {
      model.plans.forEach((plan) => {
        plan.targetExampleField = value || undefined
      })
    })
  const setNote = (value: string) =>
    updateModel(selectedIndex(), (model) => {
      model.plans.forEach((plan) => { plan.noteField = value || undefined })
    })
  const setAudio = (value: string) =>
    updateModel(selectedIndex(), (model) => {
      model.plans.forEach((plan) => { plan.audioField = value || undefined })
    })
  const setForwardOrd = (value: number) =>
    updatePlan(0, (plan) => { plan.ord = value })
  const setReverseOrd = (value: number) =>
    updateModel(selectedIndex(), (model) => {
      if (model.plans[1]) model.plans[1].ord = value
    })

  function submit(event: SubmitEvent) {
    event.preventDefault()
    props.onSave({
      version: 2,
      deckName: props.profile.deckName,
      includeSubdecks: true,
      customized: true,
      models: models(),
    })
  }

  return (
    <section class="mx-auto max-w-4xl">
      <div class="mb-7">
        <h1 class="text-3xl font-black tracking-[-0.04em]">Deck setup</h1>
        <p class="mt-2 text-[var(--muted)]">
          {models().filter((model) => model.enabled).length} of {models().length} note types enabled
        </p>
      </div>
      <form class="card-shell p-6 sm:p-8" onSubmit={submit}>
        <div class="mb-7 grid gap-3 sm:grid-cols-2">
          <For each={models()}>
            {(model, index) => {
              const report = () => compatibility(model.modelName)
              return (
                <label
                  class="flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border border-black/8 p-4"
                  onClick={() => setModelName(model.modelName)}
                >
                  <input
                    class="mt-0.5 size-5 accent-[var(--violet)]"
                    type="checkbox"
                    checked={model.enabled}
                    onChange={(event) =>
                      updateModel(index(), (next) => {
                        next.enabled = event.currentTarget.checked
                      })
                    }
                  />
                  <span class="min-w-0 flex-1">
                    <span class="flex items-center justify-between gap-2">
                      <span class="block min-w-0 flex-1 truncate font-black">{model.modelName}</span>
                      <Show when={report()}>
                        <span class={`shrink-0 rounded-full px-2 py-0.5 text-[0.68rem] font-black uppercase tracking-[0.08em] ${
                          report()?.status === 'ready'
                            ? 'bg-[var(--mint-soft)] text-[var(--mint-dark)]'
                            : report()?.status === 'review'
                              ? 'bg-[var(--yellow-soft)] text-[var(--ink)]'
                              : 'bg-[var(--coral-soft)] text-[var(--coral-dark)]'
                        }`}>
                          {report()?.status === 'ready' ? 'Ready' : report()?.status === 'review' ? 'Check' : 'Unsupported'}
                        </span>
                      </Show>
                    </span>
                    <span class="mt-1 block text-sm text-[var(--muted)]">
                      {model.label}
                      <Show when={report()}> · {report()?.noteCount} notes</Show>
                    </span>
                  </span>
                </label>
              )
            }}
          </For>
        </div>
        <Show when={selectedReport()}>
          {(report) => (
            <div
              class={`mb-6 rounded-2xl p-4 text-sm ${
                report().status === 'ready'
                  ? 'bg-[var(--mint-soft)]'
                  : report().status === 'review'
                    ? 'bg-[var(--yellow-soft)]'
                    : 'bg-[var(--coral-soft)]'
              }`}
              role="status"
            >
              <strong>{report().status === 'ready' ? 'Ready to study.' : report().status === 'review' ? 'Check this mapping.' : 'Setup required.'}</strong>
              <span class="ml-1 text-[var(--muted)]">{report().reason}</span>
            </div>
          )}
        </Show>
        <Show when={preview()}>
          {(item) => (
            <div class="mb-6 rounded-2xl bg-[var(--mint-soft)] p-5">
              <div class="flex items-center justify-between gap-3">
                <p class="text-xs font-black text-[var(--muted)]">
                  Preview {previewIndex() + 1} of {previews().length}
                </p>
                <Show when={previews().length > 1}>
                  <div class="flex gap-2">
                    <button
                      type="button"
                      class="icon-button size-9"
                      aria-label="Previous preview"
                      onClick={() =>
                        setPreviewIndex((value) =>
                          (value - 1 + previews().length) % previews().length,
                        )
                      }
                    >
                      <ChevronRight class="size-4 rotate-180" />
                    </button>
                    <button
                      type="button"
                      class="icon-button size-9"
                      aria-label="Next preview"
                      onClick={() =>
                        setPreviewIndex((value) =>
                          (value + 1) % previews().length,
                        )
                      }
                    >
                      <ChevronRight class="size-4" />
                    </button>
                  </div>
                </Show>
              </div>
              <p class="mt-3 font-black">{item().prompt || 'Media prompt'}</p>
              <p class="mt-1 text-[var(--muted)]">{item().canonicalAnswer}</p>
            </div>
          )}
        </Show>
        <Show when={setupIssues().length}>
          <div class="mb-6 rounded-2xl bg-[var(--coral-soft)] p-4 text-sm">
            <For each={setupIssues()}>
              {(issue) => <p class="font-semibold">{issue}</p>}
            </For>
          </div>
        </Show>
        <Show when={compatibility(modelName())?.diagnostics}>
          {(diagnostics) => (
            <details class="mb-6 rounded-2xl border border-black/8 bg-white p-4 text-sm">
              <summary class="cursor-pointer font-black">
                Detection details
              </summary>
              <div class="mt-3 space-y-2 text-[var(--muted)]">
                <p><strong class="text-[var(--ink)]">Templates:</strong> {diagnostics().templates.join(', ') || 'none'}</p>
                <p><strong class="text-[var(--ink)]">Prompt:</strong> {diagnostics().promptFields.join(', ') || 'not detected'}</p>
                <p><strong class="text-[var(--ink)]">Answer:</strong> {diagnostics().answerFields.join(', ') || 'not detected'}</p>
                <p><strong class="text-[var(--ink)]">Media:</strong> {diagnostics().mediaFields.join(', ') || 'none'}</p>
              </div>
            </details>
          )}
        </Show>
        <Show when={selectedReport()?.status !== 'ready'}>
          <div class="grid gap-5 sm:grid-cols-2">
          <FieldSelect label="Note type" value={modelName()} options={props.profile.modelNames} onInput={setModelName} />
          <div />
          <FieldSelect label="Prompt" value={sourceWord()} options={fields()} onInput={setSourceWord} required />
          <FieldSelect label="Answer" value={targetMeaning()} options={fields()} onInput={setTargetMeaning} required />
          <FieldSelect label="Additional answer" value={additionalAnswer()} options={fields()} onInput={setAdditionalAnswer} optional />
          <AnswerModeSelect value={answerMode()} onInput={setAnswerMode} />
          <LanguageSelect label="Prompt language" value={sourceLanguage()} onInput={setSourceLanguage} />
          <LanguageSelect label="Answer language" value={targetLanguage()} onInput={setTargetLanguage} />
          <label class="block">
            <span class="field-label">Accepted separators</span>
            <input
              class="field-control"
              value={answerSeparators()}
              onInput={(event) => setAnswerSeparators(event.currentTarget.value)}
              aria-label="Accepted separators"
            />
          </label>
          <Show when={additionalAnswer()}>
            <label class="flex items-center gap-3 self-end rounded-xl border border-black/8 px-4 py-3">
              <input
                type="checkbox"
                class="size-5 accent-[var(--violet)]"
                checked={additionalOptional()}
                onChange={(event) =>
                  setAdditionalOptional(event.currentTarget.checked)
                }
              />
              Additional answer is optional
            </label>
          </Show>
          <FieldSelect label="Source example" value={sourceExample()} options={fields()} onInput={setSourceExample} optional />
          <FieldSelect label="Target example" value={targetExample()} options={fields()} onInput={setTargetExample} optional />
          <FieldSelect label="Optional note" value={note()} options={fields()} onInput={setNote} optional />
          <FieldSelect label="Audio" value={audio()} options={fields()} onInput={setAudio} optional />
          <TemplateSelect
            label="Source → target card"
            names={templateNames()}
            value={forwardOrd()}
            onInput={setForwardOrd}
          />
          <TemplateSelect
            label="Target → source card"
            names={templateNames()}
            value={reverseOrd()}
            onInput={setReverseOrd}
          />
          </div>
        </Show>
        <div class="mt-8 flex flex-col-reverse justify-end gap-3 border-t border-black/8 pt-6 sm:flex-row">
          <Show when={props.onCancel}>
            <button type="button" class="button-quiet" onClick={props.onCancel}>Cancel</button>
          </Show>
          <button type="submit" class="button-primary" disabled={!models().some((model) => model.enabled)}>
            <Check class="size-4" />
            Save setup
          </button>
        </div>
      </form>
    </section>
  )
}

function FieldSelect(props: {
  label: string
  value: string
  options: string[]
  onInput: (value: string) => void
  optional?: boolean
  required?: boolean
}) {
  return (
    <label class="block">
      <span class="field-label">
        {props.label}
        <Show when={props.optional}><span class="font-medium text-[var(--muted)]">Optional</span></Show>
      </span>
      <select
        class="field-control"
        value={props.value}
        required={props.required}
        onInput={(event) => props.onInput(event.currentTarget.value)}
      >
        <Show when={props.optional}><option value="">Not used</option></Show>
        <For each={props.options}>{(option) => <option value={option}>{option}</option>}</For>
      </select>
    </label>
  )
}

function TemplateSelect(props: {
  label: string
  names: string[]
  value: number
  onInput: (value: number) => void
}) {
  return (
    <label class="block">
      <span class="field-label">{props.label}</span>
      <select
        class="field-control"
        value={`${props.value}`}
        onInput={(event) => props.onInput(Number(event.currentTarget.value))}
      >
        <For each={props.names}>
          {(name, index) => <option value={`${index()}`}>{name}</option>}
        </For>
      </select>
    </label>
  )
}

function LanguageSelect(props: {
  label: string
  value: AnswerLanguage
  onInput: (value: AnswerLanguage) => void
}) {
  return (
    <label class="block">
      <span class="field-label">{props.label}</span>
      <select
        class="field-control"
        value={props.value}
        onInput={(event) =>
          props.onInput(event.currentTarget.value as AnswerLanguage)
        }
      >
        <option value="german">German</option>
        <option value="english">English</option>
        <option value="plain">Other</option>
      </select>
    </label>
  )
}

function AnswerModeSelect(props: {
  value: AnswerMode
  onInput: (value: AnswerMode) => void
}) {
  return (
    <label class="block">
      <span class="field-label">Answer format</span>
      <select
        class="field-control"
        value={props.value}
        onInput={(event) =>
          props.onInput(event.currentTarget.value as AnswerMode)
        }
      >
        <option value="parts">Separate fields</option>
        <option value="alternatives">Either field</option>
        <option value="unordered">List, any order</option>
      </select>
    </label>
  )
}

function createRecoverableLoad<T>(
  source: () => string,
  load: () => Promise<T>,
) {
  const [data, setData] = createSignal<T>()
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<unknown>()
  let request = 0

  const retry = async () => {
    const current = ++request
    setLoading(true)
    setError(undefined)
    try {
      const next = await load()
      if (current === request) setData(() => next)
    } catch (caught) {
      if (current === request) setError(caught)
    } finally {
      if (current === request) setLoading(false)
    }
  }

  createEffect(() => {
    source()
    void retry()
  })

  return { data, loading, error, retry }
}

function LessonSession(props: {
  deckName: string
  storageId: string
  configuration: StudyConfig
  onExit: () => void
}) {
  const payload = createRecoverableLoad(
    () => `${props.deckName}:${JSON.stringify(props.configuration)}`,
    () => api.lessons(props.deckName, props.configuration),
  )
  const teachingStorage = sessionStorageKey(
    props.storageId,
    'lesson-teaching',
  )
  const restored = (() => {
    try {
      return JSON.parse(
        localStorage.getItem(teachingStorage) ?? 'null',
      ) as {
        teachingIndex: number
        quizzing: boolean
      } | null
    } catch {
      return null
    }
  })()
  const [teachingIndex, setTeachingIndex] = createSignal(restored?.teachingIndex ?? 0)
  const [quizzing, setQuizzing] = createSignal(restored?.quizzing ?? false)

  createEffect(() => {
    localStorage.setItem(
      teachingStorage,
      JSON.stringify({
        teachingIndex: teachingIndex(),
        quizzing: quizzing(),
      }),
    )
  })

  function completeLesson() {
    localStorage.removeItem(teachingStorage)
    props.onExit()
  }

  createEffect(() => {
    const lesson = payload.data()
    if (!payload.loading() && lesson && lesson.items.length === 0) {
      localStorage.removeItem(teachingStorage)
      localStorage.removeItem(sessionStorageKey(props.storageId, 'lesson'))
      props.onExit()
    } else if (
      !payload.loading() &&
      lesson &&
      !quizzing() &&
      teachingIndex() >= lesson.items.length
    ) {
      setTeachingIndex(0)
    }
  })

  return (
    <Show
      when={!payload.loading() && payload.data()}
      fallback={<SessionLoading title="Preparing lessons" onExit={props.onExit} error={payload.error()} retry={() => void payload.retry()} />}
    >
      {(lesson) => (
        <Show
          when={lesson().items.length}
          fallback={<SessionEmpty title="No lessons available" copy="Anki's new-card limit has no complete word pairs available right now." onExit={props.onExit} />}
        >
          <Show
            when={quizzing()}
            fallback={
              <LessonTeaching
                item={lesson().items[teachingIndex()]!}
                index={teachingIndex()}
                total={lesson().items.length}
                onNext={() => {
                  if (teachingIndex() + 1 >= lesson().items.length) setQuizzing(true)
                  else setTeachingIndex((index) => index + 1)
                }}
              />
            }
          >
            <StudyRunner
            mode="lesson"
            deckName={props.deckName}
            storageId={props.storageId}
              configuration={props.configuration}
              cards={lesson().quizCards}
              onExit={props.onExit}
              onComplete={completeLesson}
            />
          </Show>
        </Show>
      )}
    </Show>
  )
}

function ReviewSession(props: {
  deckName: string
  storageId: string
  configuration: StudyConfig
  onExit: () => void
}) {
  const payload = createRecoverableLoad(
    () => `${props.deckName}:${JSON.stringify(props.configuration)}`,
    () => api.reviews(props.deckName, props.configuration),
  )
  return (
    <Show
      when={!payload.loading() && payload.data()}
      fallback={<SessionLoading title="Building review queue" onExit={props.onExit} error={payload.error()} retry={() => void payload.retry()} />}
    >
      {(session) => (
        <Show
          when={session().cards.length}
          fallback={<SessionEmpty title="Reviews cleared" copy="Nothing is due in this deck right now." onExit={props.onExit} />}
        >
          <StudyRunner
            mode="review"
            deckName={props.deckName}
            storageId={props.storageId}
            configuration={props.configuration}
            cards={session().cards}
            onExit={props.onExit}
          />
        </Show>
      )}
    </Show>
  )
}

function LessonTeaching(props: {
  item: LessonItem
  index: number
  total: number
  onNext: () => void
}) {
  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        event.key === 'Enter' &&
        !target?.matches('input, textarea, select, button')
      ) {
        event.preventDefault()
        props.onNext()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    onCleanup(() => window.removeEventListener('keydown', onKeyDown))
  })
  const card = () => props.item.cards[0]
  const visibleDetails = () =>
    (props.item.details ?? []).filter((detail) =>
      ![
        props.item.sourceExample,
        props.item.targetExample,
        props.item.note,
        card()?.prompt,
        card()?.canonicalAnswer,
      ].includes(detail.value),
    )
  return (
    <StudyShell
      progress={props.index}
      total={props.total}
    >
      <article class="mx-auto w-full max-w-3xl">
        <div class="mb-8 flex flex-wrap items-center justify-between gap-3">
          <span class="rounded-full bg-[var(--yellow)] px-3 py-1 text-xs font-black uppercase tracking-[0.12em]">
            New word {props.index + 1} of {props.total}
          </span>
          <div class="flex flex-wrap items-center justify-end gap-3">
            <AudioButton
              filenames={
                props.item.promptAudioFilenames?.length
                  ? props.item.promptAudioFilenames
                  : props.item.audioFilenames?.length
                    ? props.item.audioFilenames
                    : [props.item.promptAudioFilename ?? props.item.audioFilename]
                        .filter((value): value is string => Boolean(value))
              }
              autoplay={props.item.contentKind === 'audio'}
              hotkey
            />
            <button class="button-soft-primary" onClick={props.onNext}>
              {props.index + 1 === props.total ? 'Start quiz' : 'Next word'}
              <ChevronRight class="size-4" />
            </button>
          </div>
        </div>
        <div class="grid gap-4 md:grid-cols-2">
          <div class="card-shell bg-[var(--mint-soft)] p-6 sm:p-8">
            <Show when={props.item.imageFilenames?.length}>
              <div class="mb-4 flex flex-wrap gap-3">
                <For each={props.item.imageFilenames}>
                  {(filename) => <img class="max-h-48 rounded-xl object-contain" src={api.mediaUrl(filename)} alt="" />}
                </For>
              </div>
            </Show>
            <h1 class="text-3xl font-black tracking-[-0.045em]">
              <GermanArticleText
                value={card()?.prompt || props.item.sourceWord || 'Listen'}
                language={card()?.promptLanguage}
              />
            </h1>
            <Show when={props.item.sourceExample}>
              <p class="mt-6 border-t border-black/10 pt-5 text-lg italic leading-8">{props.item.sourceExample}</p>
            </Show>
          </div>
          <div class="card-shell bg-[var(--violet-soft)] p-6 sm:p-8">
            <h2 class="text-3xl font-black tracking-[-0.04em]">
              <GermanArticleText
                value={card()?.canonicalAnswer || props.item.targetMeaning}
                language={card()?.answerLanguage}
              />
            </h2>
            <Show when={props.item.targetExample}>
              <p class="mt-6 border-t border-black/10 pt-5 text-lg italic leading-8">{props.item.targetExample}</p>
            </Show>
            <Show when={props.item.note}>
              <NoteContent value={props.item.note} />
            </Show>
            <For each={visibleDetails()}>
              {(detail) => (
                <p class="mt-4 text-sm leading-6 text-[var(--muted)]">
                  <strong>{humanizeField(detail.label)}:</strong> {detail.value}
                </p>
              )}
            </For>
          </div>
        </div>
      </article>
    </StudyShell>
  )
}

function StudyRunner(props: {
  mode: 'lesson' | 'review'
  deckName: string
  storageId: string
  configuration: StudyConfig
  cards: StudyCard[]
  onExit: () => void
  onComplete?: () => void
}) {
  const partsFor = (card: StudyCard): AnswerPart[] =>
    card.answerParts?.length
      ? card.answerParts
      : [{
          id: 'answer',
          label: 'Answer',
          canonicalAnswer: card.canonicalAnswer,
          acceptedAnswers: card.acceptedAnswers,
          language: card.direction === 'reverse' ? 'german' : 'english',
        }]
  const storage = sessionStorageKey(props.storageId, props.mode)
  const restored = (() => {
    try {
      return JSON.parse(
        localStorage.getItem(storage) ?? 'null',
      ) as {
        index: number
        phase: StudyPhase
        input: string
        inputs?: string[]
        result: 'correct' | 'incorrect' | null
        gradeRequestId?: string
        cards?: StudyCard[]
      } | null
    } catch {
      return null
    }
  })()
  const restoredCards = restored?.cards?.length ? restored.cards : null
  const initialCards = restoredCards ? [] : props.cards
  const [sessionCards, setSessionCards] = createSignal<StudyCard[]>(initialCards)
  const [index, setIndex] = createSignal(
    restored && restored.index < initialCards.length ? restored.index : 0,
  )
  const [phase, setPhase] = createSignal<StudyPhase>(restored?.phase ?? 'answering')
  const [inputs, setInputs] = createSignal<string[]>(
    restored?.inputs ?? [restored?.input ?? ''],
  )
  const [result, setResult] = createSignal<'correct' | 'incorrect' | null>(
    restored?.result ?? null,
  )
  const [gradeRequestId, setGradeRequestId] = createSignal(
    restored?.gradeRequestId ?? '',
  )
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal('')
  const [restoring, setRestoring] = createSignal(Boolean(restoredCards))
  const [restoreError, setRestoreError] = createSignal('')
  let answerInput: HTMLInputElement | undefined
  const current = createMemo(() => sessionCards()[index()])
  const progress = createMemo(() => index() + 1)

  async function restoreCards() {
    if (!restoredCards) return
    setRestoring(true)
    setRestoreError('')
    try {
      const ids = restoredCards.map((card) => card.cardId)
      const currentCards = await loadCards(
        props.deckName,
        ids,
        props.configuration,
      )
      const byId = new Map(currentCards.map((card) => [card.cardId, card]))
      const refreshed = ids
        .map((cardId) => byId.get(cardId))
        .filter((card): card is StudyCard => Boolean(card))
      if (refreshed.length === ids.length) {
        setSessionCards(refreshed)
      } else {
        localStorage.removeItem(storage)
        batch(() => {
          setSessionCards(props.cards)
          setIndex(0)
          setPhase('answering')
          setInputs([])
          setResult(null)
          setGradeRequestId('')
        })
      }
    } catch (caught) {
      setRestoreError(
        caught instanceof Error ? caught.message : 'Could not restore session.',
      )
    } finally {
      setRestoring(false)
    }
  }

  onMount(() => {
    if (restoredCards) void restoreCards()
  })

  createEffect(() => {
    if (restoring() || restoreError()) return
    if (index() >= sessionCards().length) {
      localStorage.removeItem(storage)
      return
    }
    localStorage.setItem(
      storage,
      JSON.stringify({
        index: index(),
        phase: phase(),
        input: inputs()[0] ?? '',
        inputs: inputs(),
        result: result(),
        gradeRequestId: gradeRequestId(),
        cards: sessionCards(),
      }),
    )
  })

  createEffect(() => {
    current()
    phase()
    queueMicrotask(() => answerInput?.focus())
  })

  async function save(
    ease: 1 | 3,
    outcome: 'correct' | 'incorrect',
    advanceAfterSave = false,
  ) {
    const card = current()
    if (!card || saving()) return
    setSaving(true)
    setError('')
    try {
      if (!card.practiceOnly) {
        const requestId =
          gradeRequestId() ||
          globalThis.crypto?.randomUUID?.() ||
          `${Date.now()}-${Math.random()}`
        setGradeRequestId(requestId)
        await api.answer(card.cardId, ease, requestId)
      }
      setResult(outcome)
      setPhase('feedback')
      if (props.mode === 'lesson' && outcome === 'incorrect') {
        setSessionCards((cards) => [
          ...cards,
          { ...card, practiceOnly: true },
        ])
      }
      if (advanceAfterSave) {
        next()
        return
      }
      void playAudioSequence(
        card.audioFilenames?.length
          ? card.audioFilenames
          : [card.audioFilename].filter(
              (value): value is string => Boolean(value),
            ),
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Grade was not saved.')
    } finally {
      setSaving(false)
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    const card = current()
    if (!card || saving()) return
    const currentPhase = phase()
    if (currentPhase === 'answering') {
      const parts = partsFor(card)
      const correct = parts.every((part, partIndex) =>
        matchesAnswerPart(inputs()[partIndex] ?? '', part),
      )
      if (correct) await save(3, 'correct')
      else setPhase('correction')
      return
    }
    if (currentPhase === 'correction') {
      const parts = partsFor(card)
      const correct = parts.every((part, partIndex) =>
        matchesAnswerPart(inputs()[partIndex] ?? '', part),
      )
      await save(
        correct ? 3 : 1,
        correct ? 'correct' : 'incorrect',
        !correct,
      )
      return
    }
    next()
  }

  function next() {
    if (index() + 1 >= sessionCards().length) {
      localStorage.removeItem(storage)
      setIndex(sessionCards().length)
      return
    }
    setIndex((value) => value + 1)
    setInputs([])
    setPhase('answering')
    setResult(null)
    setGradeRequestId('')
    setError('')
  }

  return (
    <Show
      when={!restoring() && !restoreError()}
      fallback={
        <SessionLoading
          title="Restoring session"
          onExit={props.onExit}
          error={restoreError()}
          retry={() => void restoreCards()}
        />
      }
    >
      <Show
      when={current()}
      fallback={
        <SessionComplete
          mode={props.mode}
          count={sessionCards().length}
          onExit={props.onComplete ?? props.onExit}
        />
      }
    >
      {(card) => (
        <StudyShell
          progress={progress()}
          total={sessionCards().length}
          announcement={
            error()
              ? `Connection interrupted. Answer preserved. ${error()}`
              : saving()
                ? 'Saving answer to Anki.'
                : phase() === 'correction'
                  ? 'Answer needs correction. Answer details are shown.'
                  : phase() === 'feedback'
                    ? result() === 'correct'
                      ? 'Answer accepted.'
                      : 'Answer saved as Again.'
                    : `Card ${progress()} of ${sessionCards().length}.`
          }
        >
          <article class="mx-auto w-full max-w-xl">
            <div
              class={`card-shell p-6 transition-colors sm:p-8 ${
                phase() === 'correction'
                  ? 'bg-[var(--coral-soft)]'
                  : phase() === 'feedback'
                    ? result() === 'correct'
                      ? 'bg-[var(--mint-soft)]'
                      : 'bg-[var(--coral-soft)]'
                    : 'bg-white'
              }`}
              style={{
                'background-color':
                  phase() === 'correction'
                    ? 'var(--coral-soft)'
                    : phase() === 'feedback'
                      ? result() === 'correct'
                        ? 'var(--mint-soft)'
                        : 'var(--coral-soft)'
                      : 'white',
              }}
            >
              <Show when={card().promptAudioFilename}>
                <div class="mb-5 flex justify-center">
                  <AudioButton
                    filenames={
                      card().promptAudioFilenames?.length
                        ? (card().promptAudioFilenames ?? [])
                        : [card().promptAudioFilename].filter(
                            (value): value is string => Boolean(value),
                          )
                    }
                    label="Play prompt"
                    autoplay={card().contentKind === 'audio'}
                    hotkey
                  />
                </div>
              </Show>
              <Show when={card().promptImageFilenames?.length}>
                <div class="mb-5 flex flex-wrap justify-center gap-3">
                  <For each={card().promptImageFilenames}>
                    {(filename) => (
                      <img
                        class="max-h-64 max-w-full rounded-xl object-contain"
                        src={api.mediaUrl(filename)}
                        alt=""
                      />
                    )}
                  </For>
                </div>
              </Show>
              <Show when={card().prompt}>
                <h1 class="mx-auto text-center text-3xl font-black tracking-[-0.045em] sm:text-4xl">
                  <GermanArticleText
                    value={card().prompt}
                    language={card().promptLanguage}
                  />
                </h1>
              </Show>

              <form class="mt-7" onSubmit={submit}>
                <div class="mx-auto max-w-sm space-y-3">
                  <For each={partsFor(card())}>
                    {(part, partIndex) => (
                      <label class="block">
                        <Show when={partsFor(card()).length > 1}>
                          <span class="mb-1.5 block text-sm font-black">{part.label}</span>
                        </Show>
                        <input
                          ref={(element) => {
                            if (partIndex() === 0) answerInput = element
                          }}
                          aria-label={part.label}
                          class={`h-12 w-full rounded-xl border bg-white px-4 text-center text-lg font-bold shadow-sm outline-none transition ${
                            phase() === 'correction'
                              ? 'border-[var(--coral)] focus:ring-4 focus:ring-[color:var(--coral)]/15'
                              : phase() === 'feedback'
                                ? result() === 'correct'
                                  ? 'border-[var(--mint)]'
                                  : 'border-[var(--coral)]'
                              : 'border-black/15 focus:border-[var(--violet)] focus:ring-4 focus:ring-[color:var(--violet)]/15'
                          }`}
                          value={inputs()[partIndex()] ?? ''}
                          readOnly={phase() === 'feedback'}
                          autocomplete="off"
                          autocapitalize="none"
                          spellcheck={false}
                          onInput={(event) =>
                            setInputs((current) => {
                              setGradeRequestId('')
                              setError('')
                              const next = [...current]
                              next[partIndex()] = event.currentTarget.value
                              return next
                            })
                          }
                        />
                      </label>
                    )}
                  </For>
                </div>

                <Show when={phase() === 'correction' || phase() === 'feedback'}>
                  <Feedback card={card()} />
                </Show>

                <Show when={error()}>
                  <p role="alert" class="mt-4 rounded-lg bg-[var(--coral)] px-4 py-3 text-sm font-bold text-white">
                    {error()} Answer and queue position are preserved. Submit again.
                  </p>
                </Show>

                <div class="mx-auto mt-5 max-w-sm">
                <button class="button-soft-primary w-full" disabled={saving()}>
                  <Show when={saving()} fallback={phase() === 'feedback' ? 'Continue' : phase() === 'correction' ? 'Check correction' : 'Check answer'}>
                    <LoaderCircle class="size-4 animate-spin" />
                    Saving to Anki…
                  </Show>
                  <Show when={!saving()}><ChevronRight class="size-4" /></Show>
                </button>
                </div>
              </form>
            </div>
          </article>
        </StudyShell>
      )}
      </Show>
    </Show>
  )
}

function Feedback(props: {
  card: StudyCard
}) {
  return (
    <div class="mt-6 border-t border-black/10 pt-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-2xl font-black">
            <GermanArticleText
              value={props.card.canonicalAnswer}
              language={props.card.answerLanguage}
            />
          </p>
        </div>
        <AudioButton
          filenames={
            props.card.audioFilenames?.length
              ? props.card.audioFilenames
              : [props.card.audioFilename].filter(
                  (value): value is string => Boolean(value),
                )
          }
          hotkey
        />
      </div>
      <div class="mt-5 grid gap-3 sm:grid-cols-2">
        <Show when={props.card.sourceExample}>
          <p class="rounded-xl bg-white/70 p-4 italic leading-7">{props.card.sourceExample}</p>
        </Show>
        <Show when={props.card.targetExample}>
          <p class="rounded-xl bg-white/70 p-4 italic leading-7">{props.card.targetExample}</p>
        </Show>
      </div>
      <Show when={props.card.note}>
        <NoteContent value={props.card.note} />
      </Show>
      <For each={(props.card.details ?? []).filter((detail) =>
        ![
          props.card.sourceExample,
          props.card.targetExample,
          props.card.note,
          props.card.prompt,
          props.card.canonicalAnswer,
        ].includes(detail.value),
      )}>
        {(detail) => (
          <p class="mt-3 text-sm text-[var(--muted)]">
            <strong>{humanizeField(detail.label)}:</strong> {detail.value}
          </p>
        )}
      </For>
      <Show when={props.card.answerImageFilenames?.length}>
        <div class="mt-4 flex flex-wrap gap-3">
          <For each={props.card.answerImageFilenames}>
            {(filename) => (
              <img
                class="max-h-48 max-w-full rounded-xl object-contain"
                src={api.mediaUrl(filename)}
                alt=""
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

const GERMAN_ARTICLE_CLASSES: Record<GermanGenderArticle, string> = {
  der: 'text-blue-600',
  die: 'text-red-600',
  das: 'text-green-600',
}

function GermanArticleText(props: {
  value: string
  language?: AnswerLanguage
}) {
  const headword = createMemo(() =>
    props.language === 'german' ? splitGermanArticle(props.value) : null,
  )
  return (
    <Show when={headword()} fallback={props.value}>
      {(parsed) => (
        <span aria-label={props.value}>
          <For each={parsed().articles}>
            {(article, index) => (
              <>
                <Show when={index() > 0}>/</Show>
                <span class={GERMAN_ARTICLE_CLASSES[article]}>{article}</span>
              </>
            )}
          </For>
          {' '}
          {parsed().word}
        </span>
      )}
    </Show>
  )
}

function humanizeField(name: string) {
  return name
    .replaceAll('_', ' ')
    .replace(/([a-z])([A-Z])/gu, '$1 $2')
    .replace(/^./u, (letter) => letter.toUpperCase())
}

function NoteContent(props: { value: string }) {
  return (
    <Show
      when={props.value.length > 140}
      fallback={
        <p class="mt-4 text-sm font-semibold text-[var(--muted)]">
          {props.value}
        </p>
      }
    >
      <details class="mt-4 rounded-xl bg-white/65 px-4 py-3 text-sm text-[var(--muted)]">
        <summary class="cursor-pointer font-black text-[var(--ink)]">
          Grammar note
        </summary>
        <p class="mt-3 leading-6">{props.value}</p>
      </details>
    </Show>
  )
}

async function playAudioSequence(filenames: string[]) {
  for (const filename of filenames) {
    await new Promise<void>((resolve) => {
      const audio = new Audio(api.mediaUrl(filename))
      audio.addEventListener('ended', () => resolve(), { once: true })
      audio.addEventListener('error', () => resolve(), { once: true })
      void audio.play().catch(() => resolve())
    })
  }
}

function AudioButton(props: {
  filenames: string[]
  label?: string
  autoplay?: boolean
  hotkey?: boolean
}) {
  const [playing, setPlaying] = createSignal(false)
  let autoplayKey = ''

  async function play() {
    if (!props.filenames.length || playing()) return
    setPlaying(true)
    await playAudioSequence(props.filenames)
    setPlaying(false)
  }

  createEffect(() => {
    const key = props.autoplay ? props.filenames.join('|') : ''
    if (!key || key === autoplayKey) return
    autoplayKey = key
    queueMicrotask(() => void play())
  })

  onMount(() => {
    if (!props.hotkey) return
    const replay = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const editing =
        target instanceof HTMLInputElement
          ? !target.readOnly
          : ['TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')
      if (event.key.toLocaleLowerCase() !== 'j' || editing) return
      event.preventDefault()
      void play()
    }
    window.addEventListener('keydown', replay)
    onCleanup(() => window.removeEventListener('keydown', replay))
  })

  return (
    <Show when={props.filenames.length}>
      <div class="flex items-center gap-2">
        <button class="button-quiet" type="button" onClick={() => void play()}>
          {playing() ? <Headphones class="size-4 animate-pulse" /> : <Volume2 class="size-4" />}
          {props.label ?? 'Replay audio'}
        </button>
      </div>
    </Show>
  )
}

function StudyShell(props: {
  progress: number
  total: number
  announcement?: string
  children: unknown
}) {
  return (
    <section>
      <div class="relative left-1/2 -mt-7 mb-6 w-screen -translate-x-1/2">
        <div
          class="h-2 overflow-hidden bg-black/8"
          role="progressbar"
          aria-label="Session progress"
          aria-valuemin={0}
          aria-valuemax={props.total}
          aria-valuenow={Math.min(props.progress, props.total)}
        >
          <div
            class="h-full rounded-r-full bg-[var(--violet)] transition-[width] duration-300"
            style={{ width: `${(Math.min(props.progress, props.total) / Math.max(1, props.total)) * 100}%` }}
          />
        </div>
      </div>
      <Show when={props.announcement}>
        <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {props.announcement}
        </p>
      </Show>
      {props.children as never}
      <div
        class="mx-auto mt-5 hidden max-w-xl items-center justify-end gap-4 text-xs font-semibold text-[var(--muted)] sm:flex"
        aria-label="Keyboard shortcuts"
      >
        <span><kbd>Enter</kbd> Submit / continue</span>
        <span><kbd>J</kbd> Replay audio</span>
      </div>
    </section>
  )
}

function SessionLoading(props: {
  title: string
  onExit: () => void
  error: unknown
  retry: () => void
}) {
  return (
    <section class="mx-auto mt-20 max-w-lg text-center">
      <Show when={props.error} fallback={<LoaderCircle class="mx-auto size-10 animate-spin text-[var(--violet)]" />}>
        <CircleAlert class="mx-auto size-10 text-[var(--coral)]" />
      </Show>
      <h1 class="mt-5 text-2xl font-black">{props.error ? 'Could not start session' : props.title}</h1>
      <Show when={props.error}>
        <p role="alert" class="mt-3 text-[var(--muted)]">{props.error instanceof Error ? props.error.message : 'Try again.'}</p>
      </Show>
      <div class="mt-6 flex justify-center gap-3">
        <Show when={props.error}>
          <button class="button-soft-primary" onClick={props.retry}>Retry</button>
        </Show>
        <button class="button-quiet" onClick={props.onExit}>Back to dashboard</button>
      </div>
    </section>
  )
}

function SessionEmpty(props: {
  title: string
  copy: string
  onExit: () => void
}) {
  return (
    <section class="mx-auto mt-16 max-w-lg text-center">
      <div class="mx-auto grid size-20 place-items-center rounded-full bg-[var(--mint-soft)]">
        <Check class="size-10 text-[var(--mint-dark)]" />
      </div>
      <h1 class="mt-6 text-3xl font-black">{props.title}</h1>
      <p class="mt-3 text-[var(--muted)]">{props.copy}</p>
      <button class="button-soft-primary mt-7" onClick={props.onExit}>Back to dashboard</button>
    </section>
  )
}

function SessionComplete(props: {
  mode: 'lesson' | 'review'
  count: number
  onExit: () => void
}) {
  return (
    <section class="mx-auto mt-10 max-w-xl text-center">
      <div class="mx-auto grid size-24 place-items-center rounded-[32px] bg-[var(--yellow-soft)] text-[var(--ink)] shadow-[0_10px_28px_rgb(25_34_58_/_10%)]">
        <Sparkles class="size-11" />
      </div>
      <p class="eyebrow mt-8">Session complete</p>
      <h1 class="mt-2 text-4xl font-black tracking-[-0.05em]">
        {props.count} {props.mode === 'lesson' ? 'quiz answers' : 'reviews'} done
      </h1>
      <p class="mt-4 text-[var(--muted)]">Anki saved every result.</p>
      <button class="button-soft-primary mt-8" onClick={props.onExit}>Return to dashboard</button>
    </section>
  )
}

export default App
