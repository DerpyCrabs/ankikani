import { Effect } from 'effect'
import { component, view } from 'effectweb'
import Headphones from '@effectweb/lucide/icons/headphones'
import Volume2 from '@effectweb/lucide/icons/volume-2'
import { playAudioSequence } from './playback'

type AudioProps = { filenames: string[]; fallbackFilenames?: string[] }
type ButtonProps = AudioProps & { label?: string; autoplay?: boolean; playbackKey?: number }

const trackKey = (props: AudioProps) => JSON.stringify([props.filenames, props.fallbackFilenames])
const playback = (props: AudioProps) =>
  playAudioSequence(props.filenames, props.fallbackFilenames)

export const AudioShortcut = component(
  { init: (tracks: AudioProps) => ({ tracks, failed: false }), identity: trackKey },
  (owner) => {
    function replay(event: KeyboardEvent) {
      const { tracks: props } = owner.read()
      if (!props.filenames.length || event.key.toLowerCase() !== 'j' || !(event.ctrlKey || event.metaKey))
        return
      event.preventDefault()
      owner.patch({ failed: false })
      owner.run(
        'replay',
        playback(props).pipe(
          Effect.tap((result) => Effect.sync(() => owner.patch({ failed: result === 'failed' }))),
        ),
        'replace',
      )
    }
    window.addEventListener('keydown', replay)
    owner.own(() => window.removeEventListener('keydown', replay))
    return view(({ failed }) =>
      failed ? (
        <p class="mx-auto mb-3 max-w-xl text-center text-sm font-bold text-[var(--coral)]" role="alert">
          Audio unavailable.
        </p>
      ) : null,
    )
  },
)

export const AudioButton = component(
  {
    init: (tracks: ButtonProps) => ({ tracks, playing: false, failed: false }),
    identity: (props) => JSON.stringify([trackKey(props), props.autoplay, props.playbackKey]),
  },
  (owner) => {
    function play() {
      const { tracks: props, playing } = owner.read()
      if (playing || !props.filenames.length || owner.disposed) return
      owner.patch({ playing: true, failed: false })
      owner.run(
        'play',
        playback(props).pipe(
          Effect.tap((result) =>
            Effect.sync(() => owner.patch({ failed: result === 'failed', playing: false })),
          ),
        ),
        'drop',
      )
    }
    if (owner.read().tracks.autoplay) queueMicrotask(play)
    return view(({ props, failed, playing }) =>
      props.filenames.length > 0 ? (
        <div class="flex items-center gap-2">
          <button class="button-quiet" type="button" onClick={play}>
            {playing ? <Headphones class="size-4 animate-pulse" /> : <Volume2 class="size-4" />}
            {failed ? 'Audio unavailable' : (props.label ?? 'Replay audio')}
          </button>
        </div>
      ) : null,
    )
  },
)
