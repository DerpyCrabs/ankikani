import { Choice } from './Choice'
import BookOpen from '@effectweb/lucide/icons/book-open'
import CircleAlert from '@effectweb/lucide/icons/circle-alert'
import LoaderCircle from '@effectweb/lucide/icons/loader-circle'
import RefreshCw from '@effectweb/lucide/icons/refresh-cw'
import { view } from 'effectweb'
import type { DeckSummary } from '../lib/domain'
import { CollectionImportView } from './CollectionImport'

export const Header = view<{
  decks: DeckSummary[]
  selected: string
  onSelect: (name: string) => void
  onDashboard: () => void
}>((props) => (
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
          <span class="block text-[1.08rem] font-black tracking-[-0.03em]">AnkiKani</span>
        </span>
      </button>

      <label class="relative min-w-0 max-w-[380px] flex-1 sm:min-w-72 sm:flex-initial">
        <span class="sr-only">Active deck</span>
        <Choice label="Active deck" value={props.selected} onChoose={props.onSelect}
          options={props.decks.map(deck => ({ value: deck.name, label: deck.name + (deck.subdeckCount ? ` (+${deck.subdeckCount} subdecks)` : '') }))} />
      </label>
    </div>
  </header>
))

export const ConnectionScreen = view<{
  connected: boolean | null
  error: string
  retry: () => void
}>((props) => (
  <main class="grid min-h-screen place-items-center px-5">
    <section class="card-shell w-full max-w-lg p-7 sm:p-10">
      <div class="mb-7 grid size-14 place-items-center rounded-2xl bg-[var(--yellow-soft)]">
        {props.connected !== null ? (
          <CircleAlert class="size-7" />
        ) : (
          <LoaderCircle class="size-7 animate-spin" />
        )}
      </div>
      <h1 class="text-3xl font-black tracking-[-0.04em]">
        {props.connected === null ? 'Opening your collection…' : 'No local collection yet'}
      </h1>
      <p class="mt-3 leading-7 text-[var(--muted)]">
        {props.connected === null
          ? 'Checking for a local collection.'
          : props.error || 'Import an Anki package to start studying.'}
      </p>
      {props.connected === false && (
        <>
          <CollectionImportView compact />
          <button class="button-soft-primary mt-7 w-full" onClick={() => void props.retry()}>
            <RefreshCw class="size-4" />
            Retry connection
          </button>
        </>
      )}
    </section>
  </main>
))

export const EmptyDeck = view<{ deckName: string }>((props) => (
  <section class="mx-auto mt-16 max-w-xl text-center">
    <div class="mx-auto grid size-20 place-items-center rounded-full bg-[var(--yellow)]/30">
      <BookOpen class="size-9" />
    </div>
    <h1 class="mt-6 text-3xl font-black">Nothing to study here yet</h1>
    <p class="mt-3 text-[var(--muted)]">
      <strong>{props.deckName}</strong> has no notes. Import another package from Scheduling or choose another
      deck.
    </p>
  </section>
))

export const DeckLoading = view<{ error: string; retry: () => void }>((props) => (
  <section class="mx-auto mt-20 max-w-lg text-center">
    {props.error ? (
      <CircleAlert class="mx-auto size-9 text-[var(--coral)]" />
    ) : (
      <LoaderCircle class="mx-auto size-9 animate-spin text-[var(--violet)]" />
    )}
    <h1 class="mt-5 text-xl font-black">
      {props.error ? 'Could not read deck setup' : 'Reading deck setup…'}
    </h1>
    {props.error && (
      <>
        <p class="mt-3 text-sm text-[var(--muted)]">{props.error}</p>
        <button class="button-quiet mt-6" onClick={props.retry}>
          Retry
        </button>
      </>
    )}
  </section>
))
