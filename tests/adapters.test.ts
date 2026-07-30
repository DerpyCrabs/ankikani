import { describe, expect, it } from 'vitest'
import type { AnkiCardInfo } from '../src/lib/domain'
import {
  adaptCard,
  buildDeckConfig,
  configFromLegacy,
  detectModelConfig,
  reconcileConfig,
} from '../src/lib/adapters'
import { GOETHE_MAPPING } from '../server/service'

function card(
  modelName: string,
  ord: number,
  values: Record<string, string>,
): AnkiCardInfo {
  return {
    cardId: 100 + ord,
    note: 50,
    modelName,
    ord,
    deckName: 'German',
    fields: Object.fromEntries(
      Object.entries(values).map(([name, value], order) => [
        name,
        { value, order },
      ]),
    ),
    fieldOrder: 0,
    question: '',
    answer: '',
    interval: 12,
    type: 2,
    queue: 2,
    due: 1,
    reps: 4,
    lapses: 0,
    left: 0,
    mod: 0,
    flags: 0,
  }
}

function configFor(
  sample: AnkiCardInfo,
  templateCount = 1,
  templates?: Record<string, { Front: string; Back: string }>,
) {
  const fields = Object.keys(sample.fields)
  return {
    version: 2 as const,
    deckName: sample.deckName,
    includeSubdecks: true as const,
    models: [
      detectModelConfig({
        deckName: sample.deckName,
        modelName: sample.modelName,
        fields,
        templateCount,
        templates,
        noteCount: 1,
        samples: [sample],
      }),
    ],
  }
}

describe('study-card adapters', () => {
  it('preserves legacy Goethe behavior', () => {
    const sample = card('Goethe Vocab List', 1, {
      de_word: 'die Ansage, -n',
      de_sentence: 'Hören Sie auf die Ansagen.',
      en_word: 'announcement',
      en_sentence: 'Listen to the announcements.',
      en_note: '',
      de_audio: '[sound:ansage.mp3]',
    })
    const adapted = adaptCard(
      sample,
      configFromLegacy(sample.deckName, GOETHE_MAPPING),
    )
    expect(adapted).toMatchObject({
      prompt: 'announcement',
      canonicalAnswer: 'die Ansage',
      acceptedAnswers: ['die Ansage'],
      sourceWord: 'die Ansage',
      targetMeaning: 'announcement',
      sourceExample: 'Hören Sie auf die Ansagen.',
      targetExample: 'Listen to the announcements.',
      audioFilename: 'ansage.mp3',
      direction: 'reverse',
    })
  })

  it('detects official Goethe audio field without changing recall', () => {
    const sample = card('German English Word Card', 0, {
      de_word: 'der Käse, -',
      de_sentence: 'Ich esse gern Käse.',
      en_word: 'cheese',
      en_sentence: 'I like eating cheese.',
      en_note: '',
      de_tts_audio: '[sound:kaese.mp3]',
    })
    const adapted = adaptCard(sample, configFor(sample, 2))
    expect(adapted).toMatchObject({
      prompt: 'der Käse, -',
      canonicalAnswer: 'cheese',
      promptAudioFilename: 'kaese.mp3',
      direction: 'forward',
    })
  })

  it('creates typed cloze recall from target cloze ordinal', () => {
    const sample = card('German Cloze (with audio)', 0, {
      Text: 'Ich {{c1::bin}} müde.',
      English: 'I am tired.',
      Audio: '[sound:tired.mp3]',
      Grammar: 'sein',
    })
    const adapted = adaptCard(sample, configFor(sample))
    expect(adapted).toMatchObject({
      contentKind: 'cloze',
      prompt: 'Ich … müde.',
      canonicalAnswer: 'bin',
      audioFilename: 'tired.mp3',
    })
  })

  it('uses configured language rules for cloze alternatives', () => {
    const sample = card('English Cloze', 0, {
      Text: 'It is {{c1::information/details}}.',
    })
    const adapted = adaptCard(sample, {
      version: 2,
      deckName: 'German',
      includeSubdecks: true,
      models: [{
        modelName: 'English Cloze',
        enabled: true,
        kind: 'cloze',
        label: 'English cloze',
        confidence: 1,
        plans: [{
          ord: 0,
          kind: 'cloze',
          direction: 'forward',
          directionLabel: 'English cloze',
          clozeField: 'Text',
          answerFields: [],
          answerLanguages: ['english'],
        }],
      }],
    })
    expect(adapted?.acceptedAnswers).toEqual(['information', 'details'])
  })

  it('keeps alternatives required when any source field is required', () => {
    const sample = card('Aliases', 0, {
      Prompt: 'announcement',
      Primary: 'die Ansage',
      OptionalAlias: '',
    })
    const adapted = adaptCard(sample, {
      version: 2,
      deckName: 'German',
      includeSubdecks: true,
      models: [{
        modelName: 'Aliases',
        enabled: true,
        kind: 'text',
        label: 'Aliases',
        confidence: 1,
        plans: [{
          ord: 0,
          kind: 'text',
          direction: 'reverse',
          directionLabel: 'English → German',
          promptField: 'Prompt',
          answerFields: ['Primary', 'OptionalAlias'],
          answerLanguages: ['german', 'german'],
          answerMode: 'alternatives',
          optionalAnswerFields: ['OptionalAlias'],
        }],
      }],
    })
    expect(adapted?.answerParts?.[0].required).toBe(true)
  })

  it('uses audio as listening prompt', () => {
    const sample = card('German Listening (audio-only front)', 0, {
      Audio: '[sound:hallo.mp3]',
      German: 'Guten Morgen',
      English: 'Good morning',
      Grammar: '',
    })
    const adapted = adaptCard(sample, configFor(sample))
    expect(adapted).toMatchObject({
      contentKind: 'audio',
      prompt: '',
      promptAudioFilename: 'hallo.mp3',
      canonicalAnswer: 'Guten Morgen',
    })
  })

  it('requires each irregular-verb form separately', () => {
    const sample = card('German Irregular Verb', 0, {
      Infinitiv: 'gehen',
      Praeteritum: 'ging',
      PartizipII: 'gegangen',
      Helper: 'sein',
      Meaning: 'to go',
      AudioInf: '',
      AudioForms: '[sound:gehen.mp3]',
    })
    const adapted = adaptCard(sample, configFor(sample))
    expect(adapted?.answerParts).toEqual([
      expect.objectContaining({ label: 'Infinitive', canonicalAnswer: 'gehen' }),
      expect.objectContaining({ label: 'Präteritum', canonicalAnswer: 'ging' }),
      expect.objectContaining({ label: 'Participle', canonicalAnswer: 'gegangen' }),
    ])
    expect(adapted?.details).toContainEqual({ label: 'Helper', value: 'sein' })
  })

  it('adapts generic Front/Back cards and extracts images safely', () => {
    const sample = card('Basic', 0, {
      Front: 'breakfast',
      Back: 'das Frühstück <img src="breakfast.jpg">',
    })
    const adapted = adaptCard(sample, configFor(sample, 2))
    expect(adapted).toMatchObject({
      prompt: 'breakfast',
      canonicalAnswer: 'das Frühstück',
      answerImageFilenames: ['breakfast.jpg'],
    })
  })

  it('derives reverse and typed directions from actual templates', () => {
    const sample = card('Basic typed', 1, {
      Front: 'breakfast',
      Back: 'das Frühstück',
    })
    const config = configFor(sample, 2, {
      Forward: {
        Front: '{{Front}}',
        Back: '{{FrontSide}} {{type:Back}}',
      },
      Reverse: {
        Front: '{{Back}}',
        Back: '{{FrontSide}} {{type:Front}}',
      },
    })
    expect(config.models[0].plans).toMatchObject([
      { ord: 0, promptField: 'Front', answerFields: ['Back'] },
      { ord: 1, promptField: 'Back', answerFields: ['Front'] },
    ])
    expect(adaptCard(sample, config)).toMatchObject({
      prompt: 'das Frühstück',
      canonicalAnswer: 'breakfast',
    })
  })

  it('derives audio-only listening from template media', () => {
    const sample = card('Listening', 0, {
      Audio: '[sound:one.mp3] [sound:two.mp3]',
      German: 'Guten Morgen',
    })
    const config = configFor(sample, 1, {
      Listening: {
        Front: '{{Audio}}',
        Back: '{{FrontSide}} {{type:German}}',
      },
    })
    expect(adaptCard(sample, config)).toMatchObject({
      contentKind: 'audio',
      promptAudioFilenames: ['one.mp3', 'two.mp3'],
      canonicalAnswer: 'Guten Morgen',
    })
  })

  it('understands conditional, filtered, and typed cloze templates', () => {
    const sample = card('Flexible cloze', 0, {
      Text: 'Ich {{c1::bin}} hier.',
      Extra: 'sein',
      Ignored: 'wrong',
    })
    const config = configFor(sample, 1, {
      Cloze: {
        Front: '<!-- {{Ignored}} --> {{#Text}}{{cloze:Text}}{{type:cloze:Text}}{{/Text}}',
        Back: '{{cloze:Text}} {{hint:Extra}}',
      },
    })

    expect(adaptCard(sample, config)).toMatchObject({
      contentKind: 'cloze',
      prompt: 'Ich … hier.',
      canonicalAnswer: 'bin',
    })
    expect(config.models[0].plans[0].promptField).toBe('Text')
  })

  it('flags script-only and unknown-filter templates for review', () => {
    const sample = card('Generated', 0, {
      Front: 'hello',
      Back: 'hallo',
    })
    const result = buildDeckConfig('German', [{
      modelName: sample.modelName,
      fields: Object.keys(sample.fields),
      templateCount: 1,
      noteCount: 1,
      samples: [sample],
      templates: {
        Generated: {
          Front: '<script>document.body.textContent = "prompt"</script>',
          Back: '{{mystery:Back}}',
        },
      },
    }])

    expect(result.compatibility[0]).toMatchObject({
      status: 'review',
      diagnostics: {
        issues: expect.arrayContaining([
          'Script-generated content has no detectable Anki field.',
          'Unknown template filter: mystery.',
        ]),
      },
    })
  })
})

describe('deck compatibility', () => {
  it('enables detected content types by default', () => {
    const sample = card('Basic', 0, { Front: 'hello', Back: 'hallo' })
    const result = buildDeckConfig('German', [{
      modelName: sample.modelName,
      fields: Object.keys(sample.fields),
      templateCount: 1,
      noteCount: 12,
      samples: [sample],
    }])
    expect(result.config.models[0].enabled).toBe(true)
    expect(result.compatibility[0]).toMatchObject({
      status: 'review',
      noteCount: 12,
      diagnostics: {
        fields: ['Front', 'Back'],
        issues: expect.any(Array),
      },
    })
  })

  it('preserves matching setup and replaces stale note types', () => {
    const oldConfig = configFromLegacy('German', GOETHE_MAPPING)
    oldConfig.models[0].enabled = false
    const official = card('German English Word Card', 0, {
      de_word: 'die Ansage',
      en_word: 'announcement',
      de_tts_audio: '',
    })
    const detected = configFor(official)
    expect(reconcileConfig(oldConfig, detected)?.models).toEqual(
      detected.models,
    )

    const matching = {
      ...detected.models[0],
      enabled: false,
      plans: [{ ...detected.models[0].plans[0], promptField: 'stale' }],
    }
    expect(
      reconcileConfig({ ...detected, models: [matching] }, detected)?.models[0]
        .enabled,
    ).toBe(false)
    expect(
      reconcileConfig({ ...detected, models: [matching] }, detected)?.models[0]
        .plans[0].promptField,
    ).toBe('de_word')
  })

  it('keeps deliberate generic mappings but refreshes automatic ones', () => {
    const sample = card('Basic', 0, { Front: 'hello', Back: 'hallo' })
    const detected = configFor(sample)
    const editedModel = {
      ...detected.models[0],
      plans: [{ ...detected.models[0].plans[0], promptField: 'Back' }],
    }
    const edited = { ...detected, customized: true, models: [editedModel] }
    expect(reconcileConfig(edited, detected)?.models[0].plans[0].promptField)
      .toBe('Back')
    expect(
      reconcileConfig(
        { ...edited, customized: false },
        detected,
      )?.models[0].plans[0].promptField,
    ).toBe('Front')
  })

  it('keeps deliberate mappings for high-confidence note types', () => {
    const official = card('German English Word Card', 0, {
      de_word: 'die Ansage',
      en_word: 'announcement',
      de_tts_audio: '',
    })
    const detected = configFor(official)
    const edited = {
      ...detected,
      customized: true,
      models: [{
        ...detected.models[0],
        plans: [{
          ...detected.models[0].plans[0],
          promptField: 'en_word',
        }],
      }],
    }
    expect(
      reconcileConfig(edited, detected)?.models[0].plans[0].promptField,
    ).toBe('en_word')
  })
})
