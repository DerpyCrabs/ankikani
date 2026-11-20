import Check from '@effectweb/lucide/icons/check'
import ChevronRight from '@effectweb/lucide/icons/chevron-right'
import CircleAlert from '@effectweb/lucide/icons/circle-alert'
import LoaderCircle from '@effectweb/lucide/icons/loader-circle'
import Sparkles from '@effectweb/lucide/icons/sparkles'
import {
  available,
  component,
  domBinding,
  domMount,
  list,
  observe,
  resourceError,
  view,
  type JSX,
} from 'effectweb'
import { type QueryCache, querySource } from '@effectweb/query'
import { Effect } from 'effect'
import { matchesAnswerPart, splitGermanArticle, type GermanGenderArticle } from '../lib/answers'
import { api } from '../lib/api'
import { sessionStorageKey } from '../lib/storage'
import type { AnswerLanguage, AnswerPart, LessonItem, StudyCard, StudyConfig } from '../lib/domain'
import { AudioButton, AudioShortcut } from './StudyAudio'
import { playAudioSequence, stopAudioPlayback } from './playback'
import { lessonQueue, reviewQueue, scheduledCards } from '../lib/resources'

type StudyPhase = 'answering' | 'correction' | 'retrying' | 'feedback'

function promptAudioFiles(card: StudyCard) {
  return card.promptAudioFilenames?.length
    ? card.promptAudioFilenames
    : [card.promptAudioFilename].filter((value): value is string => Boolean(value))
}

function answerAudioFiles(card: StudyCard) {
  return card.audioFilenames?.length
    ? card.audioFilenames
    : [card.audioFilename].filter((value): value is string => Boolean(value))
}

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
      !['answering', 'correction', 'retrying', 'feedback'].includes(candidate.phase ?? '') ||
      !['correct', 'incorrect', null].includes(candidate.result ?? null) ||
      (candidate.inputs !== undefined &&
        (!Array.isArray(candidate.inputs) ||
          !candidate.inputs.every((input) => typeof input === 'string'))) ||
      (candidate.cards !== undefined &&
        (!Array.isArray(candidate.cards) ||
          !candidate.cards.every((card) => card && typeof card === 'object' && Number.isFinite(card.cardId))))
    ) {
      return null
    }
    return {
      index: candidate.index!,
      phase: candidate.phase!,
      input: typeof candidate.input === 'string' ? candidate.input : '',
      inputs: candidate.inputs,
      result: candidate.result ?? null,
      gradeRequestId: typeof candidate.gradeRequestId === 'string' ? candidate.gradeRequestId : '',
      correctionUnlocked: candidate.correctionUnlocked === true,
      cards: candidate.cards,
    }
  } catch {
    return null
  }
}

type SessionProps = {
  cache: QueryCache
  deckName: string
  storageId: string
  configuration: StudyConfig
  onExit: () => void
  onGraded: () => void
}

function initialLesson(props: SessionProps) {
  const teachingStorage = sessionStorageKey(props.storageId, 'lesson-teaching')
  const restored = (() => {
    try {
      const value = JSON.parse(localStorage.getItem(teachingStorage) ?? 'null') as {
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
  return {
    teachingStorage,
    teachingIndex: restored?.teachingIndex ?? 0,
    quizzing: restored?.quizzing ?? false,
  }
}

export const LessonSession = component(
  { init: initialLesson, identity: (props) => props.storageId },
  (owner) => {
    const persist = (teachingIndex: number, quizzing: boolean) => {
      localStorage.setItem(owner.read().teachingStorage, JSON.stringify({ teachingIndex, quizzing }))
      owner.patch({ teachingIndex, quizzing })
    }
    return view(({ props, teachingStorage, teachingIndex, quizzing }) => {
      const cache = props.cache
      const args = { deck: props.deckName, config: props.configuration }
      return observe(querySource(cache, lessonQueue, args), (result) => {
        const lesson = available(result)
        if (!lesson)
          return (
            <SessionLoading
              title="Preparing lessons"
              onExit={props.onExit}
              error={resourceError(result)}
              retry={() => cache.invalidateQuery(lessonQueue, args)}
            />
          )
        const complete = () => {
          localStorage.removeItem(teachingStorage)
          props.onExit()
        }
        if (!lesson.items.length) {
          return (
            <section
              use={domMount(() => {
                localStorage.removeItem(sessionStorageKey(props.storageId, 'lesson'))
                queueMicrotask(() => {
                  if (!owner.disposed) complete()
                })
              })}
            >
              <SessionEmpty
                title="No lessons available"
                copy="Anki's new-card limit has no complete word pairs available right now."
                onExit={props.onExit}
              />
            </section>
          )
        }
        if (quizzing)
          return <StudyRunner {...props} mode="lesson" cards={lesson.quizCards} onComplete={complete} />
        const index = teachingIndex < lesson.items.length ? teachingIndex : 0
        return (
          <LessonTeaching
            item={lesson.items[index]}
            index={index}
            total={lesson.items.length}
            onNext={() =>
              index + 1 >= lesson.items.length ? persist(index, true) : persist(index + 1, false)
            }
          />
        )
      })
    })
  },
)

export const ReviewSession = view<SessionProps>((props) => {
  const cache = props.cache
  const args = { deck: props.deckName, config: props.configuration }
  return observe(querySource(cache, reviewQueue, args), (result) => {
    const session = available(result)
    if (!session)
      return (
        <SessionLoading
          title="Building review queue"
          onExit={props.onExit}
          error={resourceError(result)}
          retry={() => cache.invalidateQuery(reviewQueue, args)}
        />
      )
    if (!session.cards.length)
      return (
        <SessionEmpty
          title="Reviews cleared"
          copy="Nothing is due in this deck right now."
          onExit={props.onExit}
        />
      )
    return <StudyRunner {...props} mode="review" cards={session.cards} />
  })
})

function teachKeys(_element: HTMLElement, next: () => () => void) {
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null
    if (event.key === 'Enter' && !target?.matches('input, textarea, select, button')) {
      event.preventDefault()
      next()()
    }
  }
  window.addEventListener('keydown', onKeyDown)
  return {
    dispose: () => {
      window.removeEventListener('keydown', onKeyDown)
      stopAudioPlayback()
    },
  }
}

const LessonTeaching = view<{
  item: LessonItem
  index: number
  total: number
  onNext: () => void
}>((props) => {
  const nextLesson = () => {
    stopAudioPlayback()
    props.onNext()
  }
  const card = () => props.item.cards[0]
  const audioFiles = () =>
    props.item.promptAudioFilenames?.length
      ? props.item.promptAudioFilenames
      : props.item.audioFilenames?.length
        ? props.item.audioFilenames
        : [props.item.promptAudioFilename ?? props.item.audioFilename].filter((value): value is string =>
            Boolean(value),
          )
  const visibleDetails = () =>
    (props.item.details ?? []).filter(
      (detail) =>
        ![
          props.item.sourceExample,
          props.item.targetExample,
          props.item.note,
          card()?.prompt,
          card()?.canonicalAnswer,
        ].includes(detail.value),
    )
  return (
    <StudyShell progress={props.index + 1} total={props.total} audioAvailable={audioFiles().length > 0}>
      <AudioShortcut filenames={audioFiles()} />
      <article use={domBinding(nextLesson, teachKeys)} class="mx-auto w-full max-w-3xl">
        <div class="mb-8 flex flex-wrap items-center justify-between gap-3">
          <span class="rounded-full bg-[var(--yellow)] px-3 py-1 text-xs font-black uppercase tracking-[0.12em]">
            New word {props.index + 1} of {props.total}
          </span>
          <div class="flex flex-wrap items-center justify-end gap-3">
            <AudioButton filenames={audioFiles()} autoplay={props.item.contentKind === 'audio'} />
            <button class="button-soft-primary" onClick={nextLesson}>
              {props.index + 1 === props.total ? 'Start quiz' : 'Next word'}
              <ChevronRight class="size-4" />
            </button>
          </div>
        </div>
        <div class="grid gap-4 md:grid-cols-2">
          <div class="card-shell bg-[var(--mint-soft)] p-6 sm:p-8">
            {props.item.imageFilenames?.length ? (
              <div class="mb-4 flex flex-wrap gap-3">
                {list(props.item.imageFilenames ?? [], (filename) => (
                  <img class="max-h-48 rounded-xl object-contain" src={api.mediaUrl(filename)} alt="" />
                ))}
              </div>
            ) : null}
            <h1 class="text-3xl font-black tracking-[-0.045em]">
              <GermanArticleText
                value={card()?.prompt || props.item.sourceWord || 'Listen'}
                language={card()?.promptLanguage}
              />
            </h1>
            {props.item.sourceExample ? (
              <p class="mt-6 border-t border-black/10 pt-5 text-lg italic leading-8">
                {props.item.sourceExample}
              </p>
            ) : null}
          </div>
          <div class="card-shell bg-[var(--violet-soft)] p-6 sm:p-8">
            <h2 class="text-3xl font-black tracking-[-0.04em]">
              <GermanArticleText
                value={card()?.canonicalAnswer || props.item.targetMeaning}
                language={card()?.answerLanguage}
              />
            </h2>
            {props.item.targetExample ? (
              <p class="mt-6 border-t border-black/10 pt-5 text-lg italic leading-8">
                {props.item.targetExample}
              </p>
            ) : null}
            {props.item.note ? <NoteContent value={props.item.note} /> : null}
            {list(
              visibleDetails() ?? [],
              (item) => item.label,
              (detail) => (
                <p class="mt-4 text-sm leading-6 text-[var(--muted)]">
                  <strong>{humanizeField(detail.label)}:</strong> {detail.value}
                </p>
              ),
            )}
          </div>
        </div>
      </article>
    </StudyShell>
  )
})

type RunnerProps = SessionProps & { mode: 'lesson' | 'review'; cards: StudyCard[]; onComplete?: () => void }

const partsFor = (card: StudyCard): AnswerPart[] =>
  card.answerParts?.length
    ? card.answerParts
    : [
        {
          id: 'answer',
          label: 'Answer',
          canonicalAnswer: card.canonicalAnswer,
          acceptedAnswers: card.acceptedAnswers,
          language: card.direction === 'reverse' ? 'german' : 'english',
        },
      ]
function initialRunner(props: RunnerProps) {
  const storage = sessionStorageKey(props.storageId, props.mode)
  const restored = readStoredStudySession(storage)
  const storedCards = restored?.cards?.length ? restored.cards : null
  const index = restored && restored.index < (storedCards ?? props.cards).length ? restored.index : 0
  return {
    storage,
    storedCards,
    sessionCards: storedCards ? ([] as StudyCard[]) : props.cards,
    initial: props,
    index,
    phase: (restored?.phase === 'correction' && restored.correctionUnlocked
      ? 'retrying'
      : (restored?.phase ?? 'answering')) as StudyPhase,
    inputs: restored?.inputs ?? [restored?.input ?? ''],
    result: restored?.result ?? null,
    gradeRequestId: restored?.gradeRequestId ?? '',
    saving: false,
    error: '',
    restoring: Boolean(storedCards),
    restoreError: '',
  }
}

const StudyRunner = component(
  { init: initialRunner, identity: (props) => sessionStorageKey(props.storageId, props.mode) },
  (owner) => {
    owner.own(stopAudioPlayback)
    const { storage, storedCards, initial } = owner.read()
    const cache = initial.cache
    const patch = (changes: Partial<ReturnType<typeof initialRunner>>) => {
      owner.patch(changes)
      const { restoring, restoreError, index, sessionCards, phase, inputs, result, gradeRequestId } =
        owner.read()
      if (restoring || restoreError) return
      if (index >= sessionCards.length) localStorage.removeItem(storage)
      else
        localStorage.setItem(
          storage,
          JSON.stringify({
            index,
            cards: sessionCards,
            phase,
            inputs,
            input: inputs[0] ?? '',
            result,
            gradeRequestId,
          }),
        )
    }
    function restoreCards() {
      if (!storedCards) return
      patch({ restoring: true, restoreError: '' })
      const ids = storedCards.map((card) => card.cardId)
      owner.run(
        'restore',
        cache
          .prefetch(
            scheduledCards,
            { deck: initial.deckName, ids, config: initial.configuration },
            { refresh: true },
          )
          .pipe(
            Effect.match({
              onSuccess: (cards) => {
                const byId = new Map(cards.map((card) => [card.cardId, card]))
                const refreshed = storedCards.flatMap((stored) => {
                  const card = byId.get(stored.cardId)
                  return card ? [stored.practiceOnly ? { ...card, practiceOnly: true } : card] : []
                })
                if (refreshed.length === ids.length) patch({ sessionCards: refreshed, restoring: false })
                else
                  patch({
                    sessionCards: initial.cards,
                    restoring: false,
                    phase: 'answering',
                    index: 0,
                    inputs: [],
                    result: null,
                    gradeRequestId: '',
                  })
              },
              onFailure: (error) => patch({ restoring: false, restoreError: error.message }),
            }),
          ),
        'drop',
      )
    }
    if (storedCards) restoreCards()
    else patch({})

    function next() {
      stopAudioPlayback()
      patch({
        index: owner.read().index + 1,
        inputs: [],
        phase: 'answering',
        result: null,
        gradeRequestId: '',
        error: '',
      })
    }

    function submit(event: SubmitEvent) {
      event.preventDefault()
      const state = owner.read()
      const card = state.sessionCards[state.index]
      if (!card || state.saving) return
      if (state.phase === 'feedback') {
        next()
        return
      }
      const correcting = state.phase === 'correction'
      if (!correcting && !partsFor(card).every((part, i) => matchesAnswerPart(state.inputs[i] ?? '', part))) {
        patch({ phase: 'correction' })
        owner.run('answer-audio', playAudioSequence(answerAudioFiles(card), promptAudioFiles(card)), 'replace')
        return
      }
      const requestId = state.gradeRequestId || crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`
      patch({ saving: true, error: '', gradeRequestId: requestId })
      const grade: Effect.Effect<{ saved: boolean; stale?: boolean }, Error> = card.practiceOnly
        ? Effect.succeed({ saved: true, stale: false })
        : api.answer(card.cardId, correcting ? 1 : 3, requestId)
      owner.run(
        'grade',
        grade.pipe(
          Effect.match({
            onFailure: (error) => patch({ saving: false, error: error.message }),
            onSuccess: (response) => {
              if (!card.practiceOnly) initial.onGraded()
              if (!response.saved && !response.stale) {
                patch({ saving: false, error: 'Anki rejected the card grade.' })
                return
              }
              if (correcting && initial.mode === 'lesson' && !response.stale) {
                patch({ sessionCards: [...state.sessionCards, { ...card, practiceOnly: true }] })
              }
              patch({ saving: false })
              if (correcting || response.stale) next()
              else {
                patch({ result: 'correct', phase: 'feedback' })
                owner.run('answer-audio', playAudioSequence(answerAudioFiles(card), promptAudioFiles(card)), 'replace')
              }
            },
          }),
        ),
        'drop',
      )
    }

    return view(
      ({ props, sessionCards, index, phase, result, saving, restoring, restoreError, inputs, error }) => {
        if (restoring || restoreError)
          return (
            <SessionLoading
              title="Restoring session"
              onExit={props.onExit}
              error={restoreError}
              retry={restoreCards}
            />
          )
        const card = sessionCards[index]
        if (!card)
          return (
            <SessionComplete
              mode={props.mode}
              count={sessionCards.length}
              onExit={props.onComplete ?? props.onExit}
            />
          )
        const progress = index + 1
        const promptAudio = promptAudioFiles(card)
        const answerAudio = answerAudioFiles(card)
        const revealed = phase === 'correction' || phase === 'feedback'
        const shortcutAudio = revealed && answerAudio.length ? answerAudio : promptAudio
        const shortcutFallbackAudio = revealed && answerAudio.length ? promptAudio : []
        return (
          <StudyShell
            progress={progress}
            total={sessionCards.length}
            showCount
            audioAvailable={shortcutAudio.length > 0}
            announcement={
              error
                ? `Connection interrupted. Answer preserved. ${error}`
                : saving
                  ? 'Saving answer to Anki.'
                  : phase === 'correction'
                    ? 'Answer details are shown. Backspace to correct it, or continue.'
                    : phase === 'retrying'
                      ? 'Retype the answer, then submit it.'
                      : phase === 'feedback'
                        ? result === 'correct'
                          ? 'Answer accepted.'
                          : 'Answer saved as Again.'
                        : `Card ${progress} of ${sessionCards.length}.`
            }
          >
            <AudioShortcut filenames={shortcutAudio} fallbackFilenames={shortcutFallbackAudio} />
            <article class="mx-auto w-full max-w-xl">
              <div
                class={`card-shell p-6 transition-colors sm:p-8 ${
                  phase === 'correction'
                    ? 'bg-[var(--coral-soft)]'
                    : phase === 'feedback'
                      ? result === 'correct'
                        ? 'bg-[var(--mint-soft)]'
                        : 'bg-[var(--coral-soft)]'
                      : 'bg-white'
                }`}
                style={{
                  'background-color':
                    phase === 'correction'
                      ? 'var(--coral-soft)'
                      : phase === 'feedback'
                        ? result === 'correct'
                          ? 'var(--mint-soft)'
                          : 'var(--coral-soft)'
                        : 'white',
                }}
              >
                {card.leech ? (
                  <p class="mb-4 text-center text-xs font-black uppercase tracking-[0.12em] text-[var(--coral-dark)]">
                    Leech card
                  </p>
                ) : null}
                {promptAudio.length ? (
                  <div class="mb-5 flex justify-center">
                    <AudioButton
                      filenames={promptAudio}
                      label="Play prompt"
                      autoplay={card.contentKind === 'audio'}
                    />
                  </div>
                ) : null}
                {card.promptImageFilenames?.length ? (
                  <div class="mb-5 flex flex-wrap justify-center gap-3">
                    {list(card.promptImageFilenames ?? [], (filename) => (
                      <img
                        class="max-h-64 max-w-full rounded-xl object-contain"
                        src={api.mediaUrl(filename)}
                        alt=""
                      />
                    ))}
                  </div>
                ) : null}
                {card.prompt ? (
                  <h1 class="mx-auto text-center text-3xl font-black tracking-[-0.045em] sm:text-4xl">
                    <GermanArticleText value={card.prompt} language={card.promptLanguage} />
                  </h1>
                ) : null}

                <form class="mt-7" onSubmit={submit}>
                  <div class="mx-auto max-w-sm space-y-3">
                    {list(
                      partsFor(card) ?? [],
                      (item) => item.id,
                      (part, partIndex) => (
                        <label class="block">
                          {partsFor(card).length > 1 ? (
                            <span class="mb-1.5 block text-sm font-black">{part.label}</span>
                          ) : null}
                          <input
                            use={
                              partIndex === 0
                                ? domBinding(`${card.cardId}:${phase}:${index}`, focusAnswer)
                                : undefined
                            }
                            aria-label={part.label}
                            class={`h-12 w-full rounded-xl border bg-white px-4 text-center text-lg font-bold shadow-sm outline-none transition ${
                              phase === 'correction'
                                ? 'border-[var(--coral)] focus:ring-4 focus:ring-[color:var(--coral)]/15'
                                : phase === 'feedback'
                                  ? result === 'correct'
                                    ? 'border-[var(--mint)]'
                                    : 'border-[var(--coral)]'
                                  : 'border-black/15 focus:border-[var(--violet)] focus:ring-4 focus:ring-[color:var(--violet)]/15'
                            }`}
                            value={inputs[partIndex] ?? ''}
                            readOnly={saving || phase === 'feedback' || phase === 'correction'}
                            autocomplete="off"
                            autocapitalize="none"
                            spellcheck={false}
                            onKeyDown={(event) => {
                              if (event.key !== 'Backspace' || phase !== 'correction') {
                                return
                              }
                              event.preventDefault()
                              patch({
                                inputs: partsFor(card).map(() => ''),
                                phase: 'retrying',
                                gradeRequestId: '',
                                error: '',
                              })
                            }}
                            onInput={(event) => {
                              const next = [...owner.read().inputs]
                              next[partIndex] = event.currentTarget.value
                              patch({ inputs: next, gradeRequestId: '', error: '' })
                            }}
                          />
                        </label>
                      ),
                    )}
                  </div>

                  {phase === 'correction' || phase === 'feedback' ? (
                    <Feedback card={card} promptAudio={promptAudio} />
                  ) : null}

                  {error ? (
                    <p
                      role="alert"
                      class="mt-4 rounded-lg bg-[var(--coral)] px-4 py-3 text-sm font-bold text-white"
                    >
                      {error} Answer and queue position are preserved. Submit again.
                    </p>
                  ) : null}

                  <div class="mx-auto mt-5 max-w-sm">
                    <button class="button-soft-primary w-full" disabled={saving}>
                      {saving ? (
                        <>
                          <LoaderCircle class="size-4 animate-spin" />
                          Saving to Anki…
                        </>
                      ) : phase === 'feedback' || phase === 'correction' ? (
                        'Continue'
                      ) : (
                        'Check answer'
                      )}
                      {!saving ? <ChevronRight class="size-4" /> : null}
                    </button>
                  </div>
                </form>
              </div>
            </article>
          </StudyShell>
        )
      },
    )
  },
)

function focusAnswer(element: HTMLInputElement) {
  const focus = () =>
    queueMicrotask(() => {
      if (element.isConnected) element.focus()
    })
  focus()
  return { update: focus }
}

const Feedback = view<{
  card: StudyCard
  promptAudio: string[]
}>((props) => {
  return (
    <div class="mt-6 border-t border-black/10 pt-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-2xl font-black">
            <GermanArticleText value={props.card.canonicalAnswer} language={props.card.answerLanguage} />
          </p>
        </div>
        <AudioButton filenames={answerAudioFiles(props.card)} fallbackFilenames={props.promptAudio} />
      </div>
      <div class="mt-5 grid gap-3 sm:grid-cols-2">
        {props.card.sourceExample ? (
          <p class="rounded-xl bg-white/70 p-4 italic leading-7">{props.card.sourceExample}</p>
        ) : null}
        {props.card.targetExample ? (
          <p class="rounded-xl bg-white/70 p-4 italic leading-7">{props.card.targetExample}</p>
        ) : null}
      </div>
      {props.card.note ? <NoteContent value={props.card.note} /> : null}
      {list(
        (props.card.details ?? []).filter(
          (detail) =>
            ![
              props.card.sourceExample,
              props.card.targetExample,
              props.card.note,
              props.card.prompt,
              props.card.canonicalAnswer,
            ].includes(detail.value),
        ) ?? [],
        (item) => item.label,
        (detail) => (
          <p class="mt-3 text-sm text-[var(--muted)]">
            <strong>{humanizeField(detail.label)}:</strong> {detail.value}
          </p>
        ),
      )}
      {props.card.answerImageFilenames?.length ? (
        <div class="mt-4 flex flex-wrap gap-3">
          {list(props.card.answerImageFilenames ?? [], (filename) => (
            <img class="max-h-48 max-w-full rounded-xl object-contain" src={api.mediaUrl(filename)} alt="" />
          ))}
        </div>
      ) : null}
    </div>
  )
})

const GERMAN_ARTICLE_CLASSES: Record<GermanGenderArticle, string> = {
  der: 'text-blue-600',
  die: 'text-red-600',
  das: 'text-green-600',
}

const GermanArticleText = view<{
  value: string
  language?: AnswerLanguage
}>((props) => {
  const headword = props.language === 'german' ? splitGermanArticle(props.value) : null
  if (!headword) return props.value
  return (
    <span aria-label={props.value}>
      {list(headword.articles, (article, index) => (
        <>
          {index > 0 ? '/' : ''}
          <span class={GERMAN_ARTICLE_CLASSES[article]}>{article}</span>
        </>
      ))}{' '}
      {headword.word}
    </span>
  )
})

function humanizeField(name: string) {
  return name
    .replaceAll('_', ' ')
    .replace(/([a-z])([A-Z])/gu, '$1 $2')
    .replace(/^./u, (letter) => letter.toUpperCase())
}

const NoteContent = view<{ value: string }>((props) => {
  return props.value.length > 140 ? (
    <details class="mt-4 rounded-xl bg-white/65 px-4 py-3 text-sm text-[var(--muted)]">
      <summary class="cursor-pointer font-black text-[var(--ink)]">Grammar note</summary>
      <p class="mt-3 leading-6">{props.value}</p>
    </details>
  ) : (
    <p class="mt-4 text-sm font-semibold text-[var(--muted)]">{props.value}</p>
  )
})

const StudyShell = view<{
  progress: number
  total: number
  showCount?: boolean
  audioAvailable?: boolean
  announcement?: string
  children?: JSX.Element
}>((props) => {
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
      {props.showCount ? (
        <div class="mx-auto mb-3 flex w-full max-w-xl justify-end px-1">
          <span class="text-xs font-black tabular-nums text-[var(--muted)]">
            {Math.min(props.progress, props.total)} / {props.total}
          </span>
        </div>
      ) : null}
      {props.announcement ? (
        <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {props.announcement}
        </p>
      ) : null}
      {props.children}
      <div
        class="mx-auto mt-5 hidden max-w-xl items-center justify-end gap-4 text-xs font-semibold text-[var(--muted)] sm:flex"
        aria-label="Keyboard shortcuts"
      >
        <span>
          <kbd>Enter</kbd> Submit / continue
        </span>
        {props.audioAvailable ? (
          <span>
            <kbd>Ctrl</kbd>+<kbd>J</kbd> Replay audio
          </span>
        ) : null}
      </div>
    </section>
  )
})

const SessionLoading = view<{
  title: string
  onExit: () => void
  error: string | undefined
  retry: () => void
}>((props) => {
  return (
    <section class="mx-auto mt-20 max-w-lg text-center">
      {props.error ? (
        <CircleAlert class="mx-auto size-10 text-[var(--coral)]" />
      ) : (
        <LoaderCircle class="mx-auto size-10 animate-spin text-[var(--violet)]" />
      )}
      <h1 class="mt-5 text-2xl font-black">{props.error ? 'Could not start session' : props.title}</h1>
      {props.error ? (
        <p role="alert" class="mt-3 text-[var(--muted)]">
          {props.error}
        </p>
      ) : null}
      <div class="mt-6 flex justify-center gap-3">
        {props.error ? (
          <button class="button-soft-primary" onClick={props.retry}>
            Retry
          </button>
        ) : null}
        <button class="button-quiet" onClick={props.onExit}>
          Back to dashboard
        </button>
      </div>
    </section>
  )
})

const SessionEmpty = view<{
  title: string
  copy: string
  onExit: () => void
}>((props) => {
  return (
    <section class="mx-auto mt-16 max-w-lg text-center">
      <div class="mx-auto grid size-20 place-items-center rounded-full bg-[var(--mint-soft)]">
        <Check class="size-10 text-[var(--mint-dark)]" />
      </div>
      <h1 class="mt-6 text-3xl font-black">{props.title}</h1>
      <p class="mt-3 text-[var(--muted)]">{props.copy}</p>
      <button class="button-soft-primary mt-7" onClick={props.onExit}>
        Back to dashboard
      </button>
    </section>
  )
})

const SessionComplete = view<{
  mode: 'lesson' | 'review'
  count: number
  onExit: () => void
}>((props) => {
  return (
    <section class="mx-auto mt-10 max-w-xl text-center">
      <div class="mx-auto grid size-24 place-items-center rounded-[32px] bg-[var(--yellow-soft)] text-[var(--ink)] shadow-[0_10px_28px_rgb(25_34_58_/_10%)]">
        <Sparkles class="size-11" />
      </div>
      <p class="eyebrow mt-8">Session complete</p>
      <h1 class="mt-2 text-4xl font-black tracking-[-0.05em]">
        {props.count}{' '}
        {props.mode === 'lesson'
          ? props.count === 1
            ? 'quiz answer'
            : 'quiz answers'
          : props.count === 1
            ? 'review'
            : 'reviews'}{' '}
        done
      </h1>
      <p class="mt-4 text-[var(--muted)]">Anki saved every result.</p>
      <button class="button-soft-primary mt-8" onClick={props.onExit}>
        Return to dashboard
      </button>
    </section>
  )
})
