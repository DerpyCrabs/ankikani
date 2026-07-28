import BookOpen from 'lucide-solid/icons/book-open'
import CircleAlert from 'lucide-solid/icons/circle-alert'
import LoaderCircle from 'lucide-solid/icons/loader-circle'
import RefreshCw from 'lucide-solid/icons/refresh-cw'
import { For, Show } from 'solid-js'
import type { DeckSummary } from '../lib/domain'

export function Header(props: {
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

export function ConnectionScreen(props: {
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
          {props.connected === null ? 'Finding Ankiâ€¦' : 'Anki is out of reach'}
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

export function EmptyDeck(props: { deckName: string }) {
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

export function DeckLoading(props: { error: string; retry: () => void }) {
  return (
    <section class="mx-auto mt-20 max-w-lg text-center">
      <Show
        when={props.error}
        fallback={<LoaderCircle class="mx-auto size-9 animate-spin text-[var(--violet)]" />}
      >
        <CircleAlert class="mx-auto size-9 text-[var(--coral)]" />
      </Show>
      <h1 class="mt-5 text-xl font-black">
        {props.error ? 'Could not read deck setup' : 'Reading deck setupâ€¦'}
      </h1>
      <Show when={props.error}>
        <p class="mt-3 text-sm text-[var(--muted)]">{props.error}</p>
        <button class="button-quiet mt-6" onClick={props.retry}>Retry</button>
      </Show>
    </section>
  )
}
