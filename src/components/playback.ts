import { Effect } from 'effect'
import { api } from '../lib/api'

type AudioResult = 'played' | 'failed' | 'cancelled'
let generation = 0
let stopActive: (() => void) | undefined

export function stopAudioPlayback() {
  generation += 1
  stopActive?.()
}

function playFile(filename: string) {
  return Effect.callback<AudioResult>(resume => {
    const audio = new Audio(api.mediaUrl(filename))
    let finished = false
    function finish(result: AudioResult) {
      if (finished) return
      finished = true
      if (stopActive === cancel) stopActive = undefined
      if (result === 'cancelled') audio.pause()
      resume(Effect.succeed(result))
    }
    const cancel = () => finish('cancelled')
    stopActive = cancel
    audio.addEventListener('ended', () => finish('played'), { once: true })
    audio.addEventListener('error', () => finish('failed'), { once: true })
    void audio.play().catch(() => finish('failed'))
    return Effect.sync(cancel)
  })
}

const playFiles = Effect.fn('playFiles')(function* (files: string[], active: number) {
  let played = false
  for (const file of files) {
    if (generation !== active) return 'cancelled' as const
    const result = yield* playFile(file)
    if (result === 'cancelled') return result
    if (result === 'played') played = true
  }
  return played ? 'played' as const : 'failed' as const
})

export const playAudioSequence = Effect.fn('playAudioSequence')(function* (files: string[], fallback: string[] = []) {
  stopAudioPlayback()
  const active = generation
  const result = yield* playFiles(files, active)
  if (result !== 'failed' || !fallback.length || active !== generation) return result
  return yield* playFiles(fallback, active)
})
