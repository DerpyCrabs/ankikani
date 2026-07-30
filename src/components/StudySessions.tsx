import Check from 'lucide-solid/icons/check'
import ChevronRight from 'lucide-solid/icons/chevron-right'
import CircleAlert from 'lucide-solid/icons/circle-alert'
import Headphones from 'lucide-solid/icons/headphones'
import LoaderCircle from 'lucide-solid/icons/loader-circle'
import Sparkles from 'lucide-solid/icons/sparkles'
import Volume2 from 'lucide-solid/icons/volume-2'
import { For, Show, batch, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { matchesAnswerPart, splitGermanArticle, type GermanGenderArticle } from '../lib/answers'
import { api } from '../lib/api'
import { loadCards } from '../lib/cards'
import { sessionStorageKey } from '../lib/storage'
import type { AnswerLanguage, AnswerPart, LessonItem, StudyCard, StudyConfig } from '../lib/domain'

type StudyPhase = 'answering' | 'correction' | 'feedback'

interface StoredStudySession {
  index: number
  phase: StudyPhase
  input: string
  inputs?: string[]
  result: 'correct' | 'incorrect' | null
  gradeRequestId?: string
  correctionUnlocked?: boolean
  cards?: StudyCard[]
}

function readStoredStudySession(storage: string): StoredStudySession | null {
  try {
    const value = JSON.parse(localStorage.getItem(storage) ?? 'null') as unknown
    if (!value || typeof value !== 'object') return null
    const candidate = value as Partial<StoredStudySession>
    if (
      !Number.isInteger(candidate.index) ||
      (candidate.index ?? -1) < 0 ||
      !['answering', 'correction', 'feedback'].includes(candidate.phase ?? '') ||
      !['correct', 'incorrect', null].includes(candidate.result ?? null) ||
      (candidate.inputs !== undefined &&
        (
          !Array.isArray(candidate.inputs) ||
          !candidate.inputs.every((input) => typeof input === 'string')
        )) ||
      (candidate.cards !== undefined &&
        (
          !Array.isArray(candidate.cards) ||
          !candidate.cards.every(
            (card) =>
              card &&
              typeof card === 'object' &&
              Number.isFinite(card.cardId),
          )
        ))
    ) {
      return null
    }
    return {
      index: candidate.index!,
      phase: candidate.phase!,
      input: typeof candidate.input === 'string' ? candidate.input : '',
      inputs: candidate.inputs,
      result: candidate.result ?? null,
      gradeRequestId:
        typeof candidate.gradeRequestId === 'string'
          ? candidate.gradeRequestId
          : '',
      correctionUnlocked: candidate.correctionUnlocked === true,
      cards: candidate.cards,
    }
  } catch {
    return null
  }
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

export function LessonSession(props: {
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
      const value = JSON.parse(
        localStorage.getItem(teachingStorage) ?? 'null',
      ) as {
        teachingIndex: number
        quizzing: boolean
      } | null
      return value &&
        Number.isInteger(value.teachingIndex) &&
        value.teachingIndex >= 0 &&
        typeof value.quizzing === 'boolean'
        ? value
        : null
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
                item={
                  lesson().items[
                    Math.min(teachingIndex(), lesson().items.length - 1)
                  ]!
                }
                index={Math.min(teachingIndex(), lesson().items.length - 1)}
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

export function ReviewSession(props: {
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
  const nextLesson = () => {
    stopAudioPlayback()
    props.onNext()
  }
  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        event.key === 'Enter' &&
        !target?.matches('input, textarea, select, button')
      ) {
        event.preventDefault()
        nextLesson()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    onCleanup(() => {
      window.removeEventListener('keydown', onKeyDown)
      stopAudioPlayback()
    })
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
      progress={props.index + 1}
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
            <button class="button-soft-primary" onClick={nextLesson}>
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
  const restored = readStoredStudySession(storage)
  const restoredCards = restored?.cards?.length ? restored.cards : null
  const initialCards = restoredCards ? [] : props.cards
  const [sessionCards, setSessionCards] = createSignal<StudyCard[]>(initialCards)
  const [index, setIndex] = createSignal(
    restored &&
      restored.index < (restoredCards?.length ?? initialCards.length)
      ? restored.index
      : 0,
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
  const [correctionUnlocked, setCorrectionUnlocked] = createSignal(
    restored?.correctionUnlocked ?? false,
  )
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal('')
  const [restoring, setRestoring] = createSignal(Boolean(restoredCards))
  const [restoreError, setRestoreError] = createSignal('')
  let answerInput: HTMLInputElement | undefined
  const current = createMemo(() => sessionCards()[index()])
  const progress = createMemo(() => index() + 1)
  const correctionIsCorrect = createMemo(() => {
    const card = current()
    if (
      !card ||
      phase() !== 'correction' ||
      !correctionUnlocked()
    ) {
      return false
    }
    return partsFor(card).every((part, partIndex) =>
      matchesAnswerPart(inputs()[partIndex] ?? '', part),
    )
  })

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
        .map((cardId, cardIndex) => {
          const card = byId.get(cardId)
          return card && restoredCards[cardIndex]?.practiceOnly
            ? { ...card, practiceOnly: true }
            : card
        })
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
          setCorrectionUnlocked(false)
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
  onCleanup(stopAudioPlayback)

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
        correctionUnlocked: correctionUnlocked(),
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
    showFeedback = true,
  ) {
    const card = current()
    if (!card || saving()) return false
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
      if (props.mode === 'lesson' && outcome === 'incorrect') {
        setSessionCards((cards) => [
          ...cards,
          { ...card, practiceOnly: true },
        ])
      }
      if (showFeedback) {
        setResult(outcome)
        setPhase('feedback')
        void playAudioSequence(
          card.audioFilenames?.length
            ? card.audioFilenames
            : [card.audioFilename].filter(
                (value): value is string => Boolean(value),
              ),
        )
      }
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Grade was not saved.')
      return false
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
      else {
        setCorrectionUnlocked(false)
        setPhase('correction')
      }
      return
    }
    if (currentPhase === 'correction') {
      const parts = partsFor(card)
      const correct = parts.every((part, partIndex) =>
        matchesAnswerPart(inputs()[partIndex] ?? '', part),
      )
      if (correctionUnlocked() && !correct) return
      const saved = await save(
        correct ? 3 : 1,
        correct ? 'correct' : 'incorrect',
        false,
      )
      if (saved) next()
      return
    }
    next()
  }

  function next() {
    stopAudioPlayback()
    if (index() + 1 >= sessionCards().length) {
      localStorage.removeItem(storage)
      setIndex(sessionCards().length)
      return
    }
    batch(() => {
      setIndex((value) => value + 1)
      setInputs([])
      setPhase('answering')
      setResult(null)
      setGradeRequestId('')
      setCorrectionUnlocked(false)
      setError('')
    })
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
          showCount
          announcement={
            error()
              ? `Connection interrupted. Answer preserved. ${error()}`
              : saving()
                ? 'Saving answer to Anki.'
                : phase() === 'correction'
                  ? correctionIsCorrect()
                    ? 'Correction accepted. Continue when ready.'
                    : correctionUnlocked()
                      ? 'Correction is still incorrect.'
                      : 'Answer details are shown. Backspace to correct it, or continue.'
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
                  ? correctionIsCorrect()
                    ? 'bg-[var(--mint-soft)]'
                    : 'bg-[var(--coral-soft)]'
                  : phase() === 'feedback'
                    ? result() === 'correct'
                      ? 'bg-[var(--mint-soft)]'
                      : 'bg-[var(--coral-soft)]'
                    : 'bg-white'
              }`}
              style={{
                'background-color':
                  phase() === 'correction'
                    ? correctionIsCorrect()
                      ? 'var(--mint-soft)'
                      : 'var(--coral-soft)'
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
                    hotkey={phase() === 'answering'}
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
                              ? correctionIsCorrect()
                                ? 'border-[var(--mint)] focus:ring-4 focus:ring-[color:var(--mint)]/15'
                                : 'border-[var(--coral)] focus:ring-4 focus:ring-[color:var(--coral)]/15'
                              : phase() === 'feedback'
                                ? result() === 'correct'
                                  ? 'border-[var(--mint)]'
                                  : 'border-[var(--coral)]'
                              : 'border-black/15 focus:border-[var(--violet)] focus:ring-4 focus:ring-[color:var(--violet)]/15'
                          }`}
                          value={inputs()[partIndex()] ?? ''}
                          readOnly={
                            saving() ||
                            phase() === 'feedback' ||
                            (phase() === 'correction' && !correctionUnlocked())
                          }
                          autocomplete="off"
                          autocapitalize="none"
                          spellcheck={false}
                          onKeyDown={(event) => {
                            if (
                              event.key !== 'Backspace' ||
                              phase() !== 'correction' ||
                              correctionUnlocked()
                            ) {
                              return
                            }
                            event.preventDefault()
                            setInputs(partsFor(card()).map(() => ''))
                            setCorrectionUnlocked(true)
                            setGradeRequestId('')
                            setError('')
                            queueMicrotask(() => answerInput?.focus())
                          }}
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
                <button
                  class="button-soft-primary w-full"
                  disabled={
                    saving() ||
                    (
                      phase() === 'correction' &&
                      correctionUnlocked() &&
                      !correctionIsCorrect()
                    )
                  }
                >
                  <Show when={saving()} fallback={phase() === 'feedback' || phase() === 'correction' ? 'Continue' : 'Check answer'}>
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

let audioGeneration = 0
let stopActiveAudio: (() => void) | null = null

function stopAudioPlayback() {
  audioGeneration += 1
  stopActiveAudio?.()
  stopActiveAudio = null
}

async function playAudioSequence(filenames: string[]) {
  stopAudioPlayback()
  const generation = audioGeneration
  for (const filename of filenames) {
    if (generation !== audioGeneration) return
    await new Promise<void>((resolve) => {
      const audio = new Audio(api.mediaUrl(filename))
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        if (stopActiveAudio === cancel) stopActiveAudio = null
        resolve()
      }
      const cancel = () => {
        audio.pause()
        finish()
      }
      stopActiveAudio = cancel
      audio.addEventListener('ended', finish, { once: true })
      audio.addEventListener('error', finish, { once: true })
      void audio.play().catch(finish)
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
    const replay = (event: KeyboardEvent) => {
      if (!props.hotkey) return
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
  showCount?: boolean
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
      <Show when={props.showCount}>
        <div class="mx-auto mb-3 flex w-full max-w-xl justify-end px-1">
          <span class="text-xs font-black tabular-nums text-[var(--muted)]">
            {Math.min(props.progress, props.total)} / {props.total}
          </span>
        </div>
      </Show>
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
        {props.count}{' '}
        {props.mode === 'lesson'
          ? props.count === 1 ? 'quiz answer' : 'quiz answers'
          : props.count === 1 ? 'review' : 'reviews'}{' '}
        done
      </h1>
      <p class="mt-4 text-[var(--muted)]">Anki saved every result.</p>
      <button class="button-soft-primary mt-8" onClick={props.onExit}>Return to dashboard</button>
    </section>
  )
}
