import Brain from 'lucide-solid/icons/brain'
import Check from 'lucide-solid/icons/check'
import ChevronRight from 'lucide-solid/icons/chevron-right'
import CircleAlert from 'lucide-solid/icons/circle-alert'
import Flame from 'lucide-solid/icons/flame'
import LoaderCircle from 'lucide-solid/icons/loader-circle'
import Settings2 from 'lucide-solid/icons/settings-2'
import Sparkles from 'lucide-solid/icons/sparkles'
import X from 'lucide-solid/icons/x'
import { For, Show, createResource, createSignal, onCleanup, onMount } from 'solid-js'
import { loadCards } from '../lib/cards'
import type { DashboardData, ForecastDay, StudyConfig } from '../lib/domain'

export function Dashboard(props: {
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
            Best streak:{' '}
            <span class="text-[var(--ink)]">
              {props.data.bestStreak}{' '}
              {props.data.bestStreak === 1 ? 'day' : 'days'}
            </span>
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
        <For each={[
          'lg:col-span-4',
          'lg:col-span-4',
          'lg:col-span-4',
          'lg:col-span-5',
          'lg:col-span-7',
          'lg:col-span-12',
        ]}>
          {(span) => <div class={`h-64 rounded-[24px] bg-black/6 ${span}`} />}
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
  const [cards, { refetch }] = createResource(
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
            <Show
              when={!cards.error}
              fallback={
                <div class="my-10 text-center">
                  <p role="alert" class="text-sm font-semibold text-[var(--muted)]">
                    {cards.error instanceof Error
                      ? cards.error.message
                      : 'Scheduled cards could not load.'}
                  </p>
                  <button
                    class="button-quiet mt-4"
                    onClick={() => void refetch()}
                  >
                    Retry
                  </button>
                </div>
              }
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
          </Show>
        </div>
      </section>
    </div>
  )
}
