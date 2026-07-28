import { describe, expect, it } from 'vitest'
import {
  configStorageKey,
  deckSchemaFingerprint,
  deckStorageId,
  profileKey,
  sessionStorageKey,
} from '../src/lib/storage'

const profile = {
  deckName: 'German',
  modelNames: ['Basic'],
  fieldsByModel: { Basic: ['Front', 'Back'] },
  templatesByModel: {
    Basic: { Card: { Front: '{{Front}}', Back: '{{Back}}' } },
  },
}

describe('profile-aware storage identity', () => {
  it('separates same-named decks across profiles', () => {
    expect(deckStorageId('Main', profile)).not.toBe(
      deckStorageId('AnkiKani Test', profile),
    )
    expect(profileKey('Main')).not.toBe(profileKey('AnkiKani Test'))
  })

  it('changes when note schema changes but not template HTML styling', () => {
    const fingerprint = deckSchemaFingerprint(profile)
    expect(deckSchemaFingerprint({
      ...profile,
      templatesByModel: {
        Basic: { Card: { Front: '<b>{{Front}}</b>', Back: '{{Back}}' } },
      },
    })).toBe(fingerprint)
    expect(deckSchemaFingerprint({
      ...profile,
      fieldsByModel: { Basic: ['Front', 'Back', 'Audio'] },
    })).not.toBe(fingerprint)
  })

  it('creates scoped config and session keys', () => {
    const id = deckStorageId('Main', profile)
    expect(configStorageKey(id)).toContain(id)
    expect(sessionStorageKey(id, 'review')).toContain(`${id}.review`)
  })
})
