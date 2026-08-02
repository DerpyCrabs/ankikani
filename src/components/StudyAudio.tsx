import Headphones from 'lucide-solid/icons/headphones'
import Volume2 from 'lucide-solid/icons/volume-2'
import { Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import { api } from '../lib/api'

let audioGeneration = 0
let stopActiveAudio: (() => void) | null = null
type AudioResult = 'played' | 'failed' | 'cancelled'

export function stopAudioPlayback() {
  audioGeneration += 1
  stopActiveAudio?.()
  stopActiveAudio = null
}

async function playAudioFile(filename: string, generation: number) {
  if (generation !== audioGeneration) return 'cancelled' as const
  return new Promise<AudioResult>((resolve) => {
    const audio = new Audio(api.mediaUrl(filename))
    let finished = false
    const finish = (result: AudioResult) => {
      if (finished) return
      finished = true
      if (stopActiveAudio === cancel) stopActiveAudio = null
      resolve(result)
    }
    const cancel = () => {
      audio.pause()
      finish('cancelled')
    }
    stopActiveAudio = cancel
    audio.addEventListener('ended', () => finish('played'), { once: true })
    audio.addEventListener('error', () => finish('failed'), { once: true })
    void audio.play().catch(() => finish('failed'))
  })
}

async function playFiles(filenames: string[], generation: number) {
  let played = false
  for (const filename of filenames) {
    if (generation !== audioGeneration) return 'cancelled' as const
    const result = await playAudioFile(filename, generation)
    if (result === 'cancelled') return result
    if (result === 'played') played = true
  }
  return played ? 'played' as const : 'failed' as const
}

export async function playAudioSequence(
  filenames: string[],
  fallbackFilenames: string[] = [],
) {
  stopAudioPlayback()
  const generation = audioGeneration
  const result = await playFiles(filenames, generation)
  if (
    result !== 'failed' ||
    generation !== audioGeneration ||
    !fallbackFilenames.length
  ) {
    return result
  }
  return playFiles(fallbackFilenames, generation)
}

export function AudioShortcut(props: {
  filenames: string[]
  fallbackFilenames?: string[]
}) {
  const [failed, setFailed] = createSignal(false)

  createEffect(() => {
    props.filenames.join('|')
    props.fallbackFilenames?.join('|')
    setFailed(false)
  })

  onMount(() => {
    const replay = (event: KeyboardEvent) => {
      if (
        !props.filenames.length ||
        event.key.toLocaleLowerCase() !== 'j' ||
        (!event.ctrlKey && !event.metaKey)
      ) {
        return
      }
      event.preventDefault()
      setFailed(false)
      void playAudioSequence(
        props.filenames,
        props.fallbackFilenames,
      ).then((result) => setFailed(result === 'failed'))
    }
    window.addEventListener('keydown', replay)
    onCleanup(() => window.removeEventListener('keydown', replay))
  })

  return (
    <Show when={failed()}>
      <p class="mx-auto mb-3 max-w-xl text-center text-sm font-bold text-[var(--coral)]" role="alert">
        Audio unavailable.
      </p>
    </Show>
  )
}

export function AudioButton(props: {
  filenames: string[]
  fallbackFilenames?: string[]
  label?: string
  autoplay?: boolean
}) {
  const [playing, setPlaying] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  let autoplayKey = ''

  async function play() {
    if (!props.filenames.length || playing()) return
    setPlaying(true)
    setFailed(false)
    const played = await playAudioSequence(
      props.filenames,
      props.fallbackFilenames,
    )
    setFailed(played === 'failed')
    setPlaying(false)
  }

  createEffect(() => {
    const key = props.autoplay ? props.filenames.join('|') : ''
    if (!key || key === autoplayKey) return
    autoplayKey = key
    queueMicrotask(() => void play())
  })

  return (
    <Show when={props.filenames.length}>
      <div class="flex items-center gap-2">
        <button class="button-quiet" type="button" onClick={() => void play()}>
          {playing() ? <Headphones class="size-4 animate-pulse" /> : <Volume2 class="size-4" />}
          {failed() ? 'Audio unavailable' : props.label ?? 'Replay audio'}
        </button>
      </div>
    </Show>
  )
}
