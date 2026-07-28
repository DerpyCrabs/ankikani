import type { DeckProfile } from './domain'

const PREFIX = 'ankikani.v3'

function hash(value: string): string {
  let result = 0x811c9dc5
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0
    result = Math.imul(result, 0x01000193)
  }
  return (result >>> 0).toString(36)
}

export function profileKey(profileName: string): string {
  return `${PREFIX}.activeDeck.${hash(profileName)}`
}

export function deckSchemaFingerprint(
  profile: Pick<
    DeckProfile,
    'modelNames' | 'fieldsByModel' | 'templatesByModel'
  >,
): string {
  const schema = profile.modelNames
    .toSorted()
    .map((modelName) => ({
      modelName,
      fields: [...(profile.fieldsByModel[modelName] ?? [])],
      templates: Object.keys(profile.templatesByModel[modelName] ?? {}).toSorted(),
    }))
  return hash(JSON.stringify(schema))
}

export function deckStorageId(
  profileName: string,
  profile: Pick<
    DeckProfile,
    'deckName' | 'modelNames' | 'fieldsByModel' | 'templatesByModel'
  >,
): string {
  return `${hash(profileName)}.${hash(profile.deckName)}.${deckSchemaFingerprint(profile)}`
}

export function configStorageKey(storageId: string): string {
  return `${PREFIX}.config.${storageId}`
}

export function sessionStorageKey(
  storageId: string,
  mode: 'lesson' | 'lesson-teaching' | 'review',
): string {
  return `${PREFIX}.session.${storageId}.${mode}`
}
