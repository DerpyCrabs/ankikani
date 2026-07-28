import {
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Flame,
  Headphones,
  LoaderCircle,
  RefreshCw,
  Settings2,
  Sparkles,
  Volume2,
  X,
} from 'lucide-solid'
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js'
import { api } from './lib/api'
import { submissionDecision } from './lib/answers'
import type {
  DashboardData,
  DeckProfile,
  DeckSummary,
  FieldMapping,
  ForecastDay,
  LessonItem,
  StudyCard,
} from './lib/domain'

type View = 'dashboard' | 'mapping' | 'lesson' | 'review'
type StudyPhase = 'answering' | 'correction' | 'feedback'

const ACTIVE_DECK_KEY = 'ankikani.activeDeck'
const VIEW_PATHS: Record<View, string> = {
  dashboard: '/',
  mapping: '/fields',
  lesson: '/lessons',
  review: '/reviews',
}
const mappingKey = (deck: string) => `ankikani.mapping.${deck}`
const sessionKey = (deck: string, mode: string) =>
  `ankikani.session.${deck}.${mode}`

function viewFromPath(pathname: string): View {
  if (pathname === '/reviews') return 'review'
  if (pathname === '/lessons') return 'lesson'
  if (pathname === '/fields') return 'mapping'
  return 'dashboard'
}

function resumableView(deck: string): View {
  const lessonSession = sessionKey(deck, 'lesson')
  const reviewSession = sessionKey(deck, 'review')
  if (
    hasActiveStudySession(lessonSession) ||
    localStorage.getItem(sessionKey(deck, 'lesson-teaching'))
  ) {
    return 'lesson'
  }
  if (hasActiveStudySession(reviewSession)) return 'review'
  return 'dashboard'
}

function hasActiveStudySession(key: string): boolean {
  const stored = localStorage.getItem(key)
  if (!stored) return false
  try {
    const session = JSON.parse(stored) as {
      index?: number
      cards?: unknown[]
    }
    if (
      Array.isArray(session.cards) &&
      typeof session.index === 'number' &&
      session.index >= session.cards.length
    ) {
      localStorage.removeItem(key)
      return false
    }
    return true
  } catch {
    localStorage.removeItem(key)
    return false
  }
}

function loadMapping(deck: string): FieldMapping | null {
  const stored = localStorage.getItem(mappingKey(deck))
  if (!stored) return null
  try {
    return JSON.parse(stored) as FieldMapping
  } catch {
    return null
  }
}

function App() {
  const [connected, setConnected] = createSignal<boolean | null>(null)
  const [connectionError, setConnectionError] = createSignal('')
  const [decks, setDecks] = createSignal<DeckSummary[]>([])
  const [deckName, setDeckName] = createSignal(
    localStorage.getItem(ACTIVE_DECK_KEY) ?? '',
  )
  const [profile, setProfile] = createSignal<DeckProfile | null>(null)
  const [mapping, setMapping] = createSignal<FieldMapping | null>(null)
  const [view, setView] = createSignal<View>(viewFromPath(window.location.pathname))
  const [dashboard, { refetch: refetchDashboard }] = createResource(
    () => {
      const deck = deckName()
      const selectedMapping = mapping()
      return deck && selectedMapping ? { deck, mapping: selectedMapping } : null
    },
    ({ deck, mapping: selectedMapping }) =>
      api.dashboard(deck, selectedMapping),
  )

  async function connect() {
    setConnected(null)
    setConnectionError('')
    try {
      await api.health()
      const availableDecks = await api.decks()
      setDecks(availableDecks)
      let selected = deckName()
      if (!availableDecks.some((deck) => deck.name === selected)) {
        selected =
          availableDecks.find((deck) => deck.name !== 'Default')?.name ??
          availableDecks[0]?.name ??
          ''
        setDeckName(selected)
      }
      setConnected(true)
    } catch (error) {
      setConnected(false)
      setConnectionError(
        error instanceof Error ? error.message : 'Could not connect to Anki.',
      )
    }
  }

  async function configureDeck(selectedDeck: string) {
    if (!selectedDeck) return
    localStorage.setItem(ACTIVE_DECK_KEY, selectedDeck)
    setProfile(null)
    setMapping(null)
    const requestedView = viewFromPath(window.location.pathname)
    navigate(
      requestedView === 'dashboard' ? resumableView(selectedDeck) : requestedView,
      true,
    )
    try {
      const nextProfile = await api.profile(selectedDeck)
      setProfile(nextProfile)
      const stored = loadMapping(selectedDeck)
      const nextMapping = stored ?? nextProfile.suggestedMapping
      if (nextMapping) {
        setMapping(nextMapping)
        if (!stored) {
          localStorage.setItem(mappingKey(selectedDeck), JSON.stringify(nextMapping))
        }
      } else if (nextProfile.modelNames.length) {
        navigate('mapping', true)
      }
    } catch (error) {
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

  function saveMapping(nextMapping: FieldMapping) {
    localStorage.setItem(mappingKey(deckName()), JSON.stringify(nextMapping))
    setMapping(nextMapping)
    navigate('dashboard')
  }

  createEffect(() => {
    if (connected() && deckName()) void configureDeck(deckName())
  })

  onMount(() => {
    const onPopState = () => setView(viewFromPath(window.location.pathname))
    window.addEventListener('popstate', onPopState)
    onCleanup(() => window.removeEventListener('popstate', onPopState))
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
            fallback={<DeckLoading />}
          >
            <Show
              when={profile()!.modelNames.length}
              fallback={<EmptyDeck deckName={deckName()} />}
            >
              <Switch>
                <Match when={view() === 'mapping' && profile()}>
                  <MappingScreen
                    profile={profile()!}
                    existing={mapping()}
                    onSave={saveMapping}
                    onCancel={mapping() ? () => navigate('dashboard') : undefined}
                  />
                </Match>
                <Match when={view() === 'lesson' && mapping()}>
                  <LessonSession
                    deckName={deckName()}
                    mapping={mapping()!}
                    onExit={() => {
                      navigate('dashboard')
                      void refetchDashboard()
                    }}
                  />
                </Match>
                <Match when={view() === 'review' && mapping()}>
                  <ReviewSession
                    deckName={deckName()}
                    mapping={mapping()!}
                    onExit={() => {
                      navigate('dashboard')
                      void refetchDashboard()
                    }}
                  />
                </Match>
                <Match when={mapping()}>
                  <Dashboard
                    data={dashboard()}
                    loading={dashboard.loading}
                    error={dashboard.error}
                    deckName={deckName()}
                    mapping={mapping()!}
                    onLessons={() => navigate('lesson')}
                    onReviews={() => navigate('review')}
                    onConfigure={() => navigate('mapping')}
                    onRetry={() => void refetchDashboard()}
                  />
                </Match>
                <Match when={!mapping() && profile()}>
                  <MappingScreen
                    profile={profile()!}
                    existing={null}
                    onSave={saveMapping}
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
              {(deck) => <option value={deck.name}>{deck.name}</option>}
            </For>
          </select>
          <ChevronDown
            aria-hidden="true"
            class="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]"
          />
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
      <section class="w-full max-w-lg border-2 border-[var(--ink)] bg-white p-7 shadow-[8px_8px_0_var(--ink)] sm:p-10">
        <div class="mb-7 grid size-14 place-items-center rounded-2xl bg-[var(--yellow)]">
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
          <ol class="mt-6 space-y-2 border-l-3 border-[var(--yellow)] pl-5 text-sm font-semibold">
            <li>1. Open Anki Desktop on this computer.</li>
            <li>2. Keep AnkiConnect enabled.</li>
            <li>3. Retry this connection.</li>
          </ol>
          <button class="button-primary mt-7 w-full" onClick={() => void props.retry()}>
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

function DeckLoading() {
  return (
    <section class="mx-auto mt-20 max-w-lg text-center">
      <LoaderCircle class="mx-auto size-9 animate-spin text-[var(--violet)]" />
      <h1 class="mt-5 text-xl font-black">Reading deck setup…</h1>
    </section>
  )
}

function Dashboard(props: {
  data: DashboardData | undefined
  loading: boolean
  error: unknown
  deckName: string
  mapping: FieldMapping
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
                mapping={props.mapping}
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
  return (
    <article class="card-shell min-w-0 p-6 sm:p-8 lg:col-span-12">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <h2 class="text-2xl font-black">Active item spread</h2>
        <div class="flex flex-wrap gap-4 text-xs font-bold text-[var(--muted)]">
          <Legend color="var(--coral)" label="German → English weaker" />
          <Legend color="var(--violet)" label="English → German weaker" />
          <Legend color="var(--mint)" label="Balanced" />
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
                        <SpreadSegment
                          count={stage.forwardWeak}
                          total={stage.total}
                          color="var(--coral)"
                        />
                        <SpreadSegment
                          count={stage.reverseWeak}
                          total={stage.total}
                          color="var(--violet)"
                        />
                        <SpreadSegment
                          count={stage.balanced}
                          total={stage.total}
                          color="var(--mint)"
                        />
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
  mapping: FieldMapping
  onClose: () => void
}) {
  const [cards] = createResource(
    () => props.day.cardIds,
    (ids) => api.cards(ids, props.mapping),
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

function MappingScreen(props: {
  profile: DeckProfile
  existing: FieldMapping | null
  onSave: (mapping: FieldMapping) => void
  onCancel?: () => void
}) {
  const initialModel =
    props.existing?.modelName ??
    props.profile.suggestedMapping?.modelName ??
    props.profile.modelNames[0] ??
    ''
  const [modelName, setModelName] = createSignal(initialModel)
  const fields = createMemo(() => props.profile.fieldsByModel[modelName()] ?? [])
  const suggested = props.existing ?? props.profile.suggestedMapping
  const choose = (preferred: string | undefined, fallback: number) =>
    preferred && fields().includes(preferred) ? preferred : fields()[fallback] ?? ''
  const [sourceWord, setSourceWord] = createSignal(choose(suggested?.sourceWord, 0))
  const [targetMeaning, setTargetMeaning] = createSignal(
    choose(suggested?.targetMeaning, 1),
  )
  const [sourceExample, setSourceExample] = createSignal(
    choose(suggested?.sourceExample, 2),
  )
  const [targetExample, setTargetExample] = createSignal(
    choose(suggested?.targetExample, 3),
  )
  const [note, setNote] = createSignal(choose(suggested?.note, 4))
  const [audio, setAudio] = createSignal(choose(suggested?.audio, 5))
  const [sourceLabel, setSourceLabel] = createSignal(
    suggested?.sourceLabel ?? 'Source',
  )
  const [targetLabel, setTargetLabel] = createSignal(
    suggested?.targetLabel ?? 'Meaning',
  )
  const [forwardOrd, setForwardOrd] = createSignal(suggested?.forwardOrd ?? 0)
  const [reverseOrd, setReverseOrd] = createSignal(suggested?.reverseOrd ?? 1)
  const templateNames = createMemo(
    () => Object.keys(props.profile.templatesByModel[modelName()] ?? {}),
  )

  createEffect(() => {
    const available = fields()
    if (!available.includes(sourceWord())) setSourceWord(available[0] ?? '')
    if (!available.includes(targetMeaning())) {
      setTargetMeaning(available[1] ?? available[0] ?? '')
    }
    if (sourceExample() && !available.includes(sourceExample())) setSourceExample('')
    if (targetExample() && !available.includes(targetExample())) setTargetExample('')
    if (note() && !available.includes(note())) setNote('')
    if (audio() && !available.includes(audio())) setAudio('')
    const maxOrd = Math.max(0, templateNames().length - 1)
    if (forwardOrd() > maxOrd) setForwardOrd(0)
    if (reverseOrd() > maxOrd) setReverseOrd(Math.min(1, maxOrd))
  })

  function submit(event: SubmitEvent) {
    event.preventDefault()
    props.onSave({
      modelName: modelName(),
      sourceWord: sourceWord(),
      targetMeaning: targetMeaning(),
      sourceExample: sourceExample() || undefined,
      targetExample: targetExample() || undefined,
      note: note() || undefined,
      audio: audio() || undefined,
      forwardOrd: forwardOrd(),
      reverseOrd: reverseOrd(),
      sourceLabel: sourceLabel().trim() || 'Source',
      targetLabel: targetLabel().trim() || 'Meaning',
    })
  }

  return (
    <section class="mx-auto max-w-3xl">
      <div class="mb-7">
        <p class="eyebrow">Deck setup</p>
        <h1 class="mt-1 text-3xl font-black tracking-[-0.04em]">
          Map vocabulary fields
        </h1>
        <p class="mt-3 max-w-2xl text-[var(--muted)]">
          AnkiKani reads these fields only. Your Anki cards and templates stay untouched.
        </p>
      </div>
      <form class="card-shell p-6 sm:p-8" onSubmit={submit}>
        <div class="grid gap-5 sm:grid-cols-2">
          <FieldSelect label="Note type" value={modelName()} options={props.profile.modelNames} onInput={setModelName} />
          <div />
          <TextField label="Source language label" value={sourceLabel()} onInput={setSourceLabel} />
          <TextField label="Target language label" value={targetLabel()} onInput={setTargetLabel} />
          <FieldSelect label="Source word" value={sourceWord()} options={fields()} onInput={setSourceWord} required />
          <FieldSelect label="Target meaning" value={targetMeaning()} options={fields()} onInput={setTargetMeaning} required />
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
        <div class="mt-8 flex flex-col-reverse justify-end gap-3 border-t border-black/8 pt-6 sm:flex-row">
          <Show when={props.onCancel}>
            <button type="button" class="button-quiet" onClick={props.onCancel}>Cancel</button>
          </Show>
          <button type="submit" class="button-primary">
            <Check class="size-4" />
            Save mapping
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

function TextField(props: {
  label: string
  value: string
  onInput: (value: string) => void
}) {
  return (
    <label class="block">
      <span class="field-label">{props.label}</span>
      <input class="field-control" value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} />
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

function LessonSession(props: {
  deckName: string
  mapping: FieldMapping
  onExit: () => void
}) {
  const [payload] = createResource(() => api.lessons(props.deckName, props.mapping))
  const teachingStorage = sessionKey(props.deckName, 'lesson-teaching')
  const restored = (() => {
    try {
      return JSON.parse(localStorage.getItem(teachingStorage) ?? 'null') as {
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
    const lesson = payload()
    if (!payload.loading && lesson && lesson.items.length === 0) {
      localStorage.removeItem(teachingStorage)
      localStorage.removeItem(sessionKey(props.deckName, 'lesson'))
      props.onExit()
    }
  })

  return (
    <Show
      when={!payload.loading && payload()}
      fallback={<SessionLoading title="Preparing lessons" onExit={props.onExit} error={payload.error} />}
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
  mapping: FieldMapping
  onExit: () => void
}) {
  const [payload] = createResource(() => api.reviews(props.deckName, props.mapping))
  return (
    <Show
      when={!payload.loading && payload()}
      fallback={<SessionLoading title="Building review queue" onExit={props.onExit} error={payload.error} />}
    >
      {(session) => (
        <Show
          when={session().cards.length}
          fallback={<SessionEmpty title="Reviews cleared" copy="Nothing is due in this deck right now." onExit={props.onExit} />}
        >
          <StudyRunner mode="review" deckName={props.deckName} cards={session().cards} onExit={props.onExit} />
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
          <AudioButton filename={props.item.audioFilename} />
        </div>
        <div class="grid gap-4 md:grid-cols-2">
          <div class="card-shell bg-[var(--mint-soft)] p-6 sm:p-8">
            <p class="eyebrow">German</p>
            <h1 class="mt-3 text-4xl font-black tracking-[-0.045em]">{props.item.sourceWord}</h1>
            <Show when={props.item.sourceExample}>
              <p class="mt-6 border-t border-black/10 pt-5 text-lg italic leading-8">{props.item.sourceExample}</p>
            </Show>
          </div>
          <div class="card-shell bg-[var(--violet-soft)] p-6 sm:p-8">
            <p class="eyebrow">English</p>
            <h2 class="mt-3 text-3xl font-black tracking-[-0.04em]">{props.item.targetMeaning}</h2>
            <Show when={props.item.targetExample}>
              <p class="mt-6 border-t border-black/10 pt-5 text-lg italic leading-8">{props.item.targetExample}</p>
            </Show>
            <Show when={props.item.note}>
              <p class="mt-4 text-sm font-semibold text-[var(--muted)]">{props.item.note}</p>
            </Show>
          </div>
        </div>
        <button class="button-soft-primary mt-8 w-full sm:ml-auto sm:flex sm:w-auto" onClick={props.onNext}>
          {props.index + 1 === props.total ? 'Start quiz' : 'Next word'}
          <ChevronRight class="size-4" />
        </button>
      </article>
    </StudyShell>
  )
}

function StudyRunner(props: {
  mode: 'lesson' | 'review'
  deckName: string
  cards: StudyCard[]
  onExit: () => void
  onComplete?: () => void
}) {
  const storage = sessionKey(props.deckName, props.mode)
  const restored = (() => {
    try {
      return JSON.parse(localStorage.getItem(storage) ?? 'null') as {
        index: number
        phase: StudyPhase
        input: string
        result: 'correct' | 'incorrect' | null
        cards?: StudyCard[]
      } | null
    } catch {
      return null
    }
  })()
  const sessionCards =
    restored?.cards?.length ? restored.cards : props.cards
  const [index, setIndex] = createSignal(
    restored && restored.index < sessionCards.length ? restored.index : 0,
  )
  const [phase, setPhase] = createSignal<StudyPhase>(restored?.phase ?? 'answering')
  const [input, setInput] = createSignal(restored?.input ?? '')
  const [result, setResult] = createSignal<'correct' | 'incorrect' | null>(
    restored?.result ?? null,
  )
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal('')
  let answerInput: HTMLInputElement | undefined
  const current = createMemo(() => sessionCards[index()])
  const progress = createMemo(() => index() + 1)

  createEffect(() => {
    if (index() >= sessionCards.length) {
      localStorage.removeItem(storage)
      return
    }
    localStorage.setItem(
      storage,
      JSON.stringify({
        index: index(),
        phase: phase(),
        input: input(),
        result: result(),
        cards: sessionCards,
      }),
    )
  })

  createEffect(() => {
    current()
    phase()
    queueMicrotask(() => answerInput?.focus())
  })

  async function save(ease: 1 | 3, outcome: 'correct' | 'incorrect') {
    const card = current()
    if (!card || saving()) return
    setSaving(true)
    setError('')
    try {
      await api.answer(card.cardId, ease)
      setResult(outcome)
      setPhase('feedback')
      if (card.audioFilename) {
        const audio = new Audio(api.mediaUrl(card.audioFilename))
        void audio.play().catch(() => undefined)
      }
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
    const language = card.direction === 'reverse' ? 'german' : 'english'
    const currentPhase = phase()
    if (currentPhase === 'answering' || currentPhase === 'correction') {
      const decision = submissionDecision(
        currentPhase,
        input(),
        card.acceptedAnswers,
        language,
      )
      if (decision.action === 'show-correction') {
        setPhase('correction')
      } else {
        await save(decision.ease, decision.outcome)
      }
      return
    }
    next()
  }

  function next() {
    if (index() + 1 >= sessionCards.length) {
      localStorage.removeItem(storage)
      setIndex(sessionCards.length)
      return
    }
    setIndex((value) => value + 1)
    setInput('')
    setPhase('answering')
    setResult(null)
    setError('')
  }

  return (
    <Show
      when={current()}
      fallback={
        <SessionComplete
          mode={props.mode}
          count={sessionCards.length}
          onExit={props.onComplete ?? props.onExit}
        />
      }
    >
      {(card) => (
        <StudyShell
          progress={progress()}
          total={sessionCards.length}
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
              <h1 class="mx-auto text-center text-3xl font-black tracking-[-0.045em] sm:text-4xl">
                {card().prompt}
              </h1>

              <form class="mt-7" onSubmit={submit}>
                <label class="mx-auto block max-w-sm">
                  <span class="sr-only">Type your answer</span>
                  <input
                    ref={answerInput}
                    class={`h-12 w-full rounded-xl border bg-white px-4 text-center text-lg font-bold shadow-sm outline-none transition ${
                      phase() === 'correction'
                        ? 'border-[var(--coral)] focus:ring-4 focus:ring-[color:var(--coral)]/15'
                        : phase() === 'feedback'
                          ? result() === 'correct'
                            ? 'border-[var(--mint)]'
                            : 'border-[var(--coral)]'
                        : 'border-black/15 focus:border-[var(--violet)] focus:ring-4 focus:ring-[color:var(--violet)]/15'
                    }`}
                    value={input()}
                    readOnly={phase() === 'feedback'}
                    autocomplete="off"
                    autocapitalize="none"
                    spellcheck={false}
                    onInput={(event) => setInput(event.currentTarget.value)}
                  />
                </label>

                <Show when={phase() === 'correction'}>
                  <div class="mt-5 rounded-xl bg-white/75 p-4">
                    <p class="text-xs font-black uppercase tracking-[0.12em] text-[var(--coral-dark)]">
                      Expected answer
                    </p>
                    <p class="mt-1 text-xl font-black">{card().canonicalAnswer}</p>
                    <Show when={card().acceptedAnswers.length > 1}>
                      <p class="mt-1 text-sm text-[var(--muted)]">
                        Also accepted: {card().acceptedAnswers.slice(1).join(' · ')}
                      </p>
                    </Show>
                    <p class="mt-3 text-sm font-semibold text-[var(--muted)]">
                      Clear and retype it for Good, or submit this answer again for Again.
                    </p>
                  </div>
                </Show>

                <Show when={phase() === 'feedback'}>
                  <Feedback card={card()} />
                </Show>

                <Show when={error()}>
                  <p role="alert" class="mt-4 rounded-lg bg-[var(--coral)] px-4 py-3 text-sm font-bold text-white">
                    {error()} Your card is still here; retry safely.
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
  )
}

function Feedback(props: {
  card: StudyCard
}) {
  return (
    <div class="mt-6 border-t border-black/10 pt-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-2xl font-black">{props.card.canonicalAnswer}</p>
        </div>
        <AudioButton filename={props.card.audioFilename} />
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
        <p class="mt-3 text-sm font-semibold text-[var(--muted)]">{props.card.note}</p>
      </Show>
    </div>
  )
}

function AudioButton(props: { filename: string | null }) {
  const [playing, setPlaying] = createSignal(false)
  async function play() {
    if (!props.filename) return
    setPlaying(true)
    const audio = new Audio(api.mediaUrl(props.filename))
    audio.addEventListener('ended', () => setPlaying(false), { once: true })
    audio.addEventListener('error', () => setPlaying(false), { once: true })
    await audio.play().catch(() => setPlaying(false))
  }
  return (
    <Show when={props.filename}>
      <button class="button-quiet" type="button" onClick={() => void play()}>
        {playing() ? <Headphones class="size-4 animate-pulse" /> : <Volume2 class="size-4" />}
        Replay audio
      </button>
    </Show>
  )
}

function StudyShell(props: {
  progress: number
  total: number
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
      {props.children as never}
    </section>
  )
}

function SessionLoading(props: {
  title: string
  onExit: () => void
  error: unknown
}) {
  return (
    <section class="mx-auto mt-20 max-w-lg text-center">
      <Show when={props.error} fallback={<LoaderCircle class="mx-auto size-10 animate-spin text-[var(--violet)]" />}>
        <CircleAlert class="mx-auto size-10 text-[var(--coral)]" />
      </Show>
      <h1 class="mt-5 text-2xl font-black">{props.error ? 'Could not start session' : props.title}</h1>
      <Show when={props.error}><p class="mt-3 text-[var(--muted)]">{props.error instanceof Error ? props.error.message : 'Try again.'}</p></Show>
      <button class="button-quiet mt-6" onClick={props.onExit}>Back to dashboard</button>
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
      <p class="mt-4 text-[var(--muted)]">Anki has every result. Dashboard is ready to refresh.</p>
      <button class="button-soft-primary mt-8" onClick={props.onExit}>Return to dashboard</button>
    </section>
  )
}

export default App
