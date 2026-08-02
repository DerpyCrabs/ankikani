// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { playAudioSequence, stopAudioPlayback } from '../src/components/StudyAudio'

class FakeAudio {
  static sources: string[] = []
  private listeners = new Map<string, () => void>()

  constructor(private readonly source: string) {
    FakeAudio.sources.push(source)
  }

  addEventListener(event: string, listener: () => void) {
    this.listeners.set(event, listener)
  }

  pause() {}

  async play() {
    queueMicrotask(() => {
      this.listeners.get(this.source.includes('broken') ? 'error' : 'ended')?.()
    })
  }
}

afterEach(() => {
  stopAudioPlayback()
  FakeAudio.sources = []
  vi.unstubAllGlobals()
})

describe('study audio', () => {
  it('falls back to prompt audio when answer audio fails', async () => {
    vi.stubGlobal('Audio', FakeAudio)

    await expect(
      playAudioSequence(['broken-answer.mp3'], ['working-prompt.mp3']),
    ).resolves.toBe('played')
    expect(FakeAudio.sources).toEqual([
      '/api/media?filename=broken-answer.mp3',
      '/api/media?filename=working-prompt.mp3',
    ])
  })
})
