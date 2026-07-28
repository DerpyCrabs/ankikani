import type {
  AnkiCardInfo,
  AnswerLanguage,
  AnswerPart,
  CardPlan,
  DeckConfig,
  FieldMapping,
  ModelCompatibility,
  ModelConfig,
  StudyCard,
  StudyConfig,
  StudyContentKind,
  StudyDetail,
} from './domain'
import {
  answerVariants,
  audioFilename,
  audioFilenames,
  germanAnswerVariants,
  imageFilenames,
  stripAudio,
  stripHtml,
} from './answers'

interface DetectionInput {
  deckName: string
  modelName: string
  fields: string[]
  templateCount?: number
  templates?: Record<string, { Front: string; Back: string }>
  noteCount: number
  samples: AnkiCardInfo[]
}

const GERMAN_FIELD = /(^de($|_)|german|deutsch|infinitiv|praeteritum|partizip|plural|artikel)/iu
const ENGLISH_FIELD = /(^en($|_)|english|englisch|meaning|translation)/iu

function field(card: AnkiCardInfo, name?: string): string {
  return name ? card.fields[name]?.value ?? '' : ''
}

function plain(value: string): string {
  return stripAudio(stripHtml(value)).replace(/\s+/gu, ' ').trim()
}

function variants(
  value: string,
  language: AnswerLanguage,
  separators?: string[],
): string[] {
  return answerVariants(value, language, separators)
}

function inferLanguage(
  fieldName: string,
  values: string[],
): AnswerLanguage {
  if (GERMAN_FIELD.test(fieldName)) return 'german'
  if (ENGLISH_FIELD.test(fieldName)) return 'english'
  const joined = values.map(plain).join(' ').toLocaleLowerCase()
  const germanScore =
    Number(/\b(der|die|das|ein|eine|ich|du|sie|wir|ist|sind)\b/iu.test(joined)) +
    Number(/[äöüß]/iu.test(joined))
  const englishScore =
    Number(/\b(the|to|a|an|is|are|you|we|they)\b/iu.test(joined)) +
    Number(/\b(not|with|from|for)\b/iu.test(joined))
  if (germanScore > englishScore) return 'german'
  if (englishScore > germanScore) return 'english'
  return 'plain'
}

function plan(
  value: Omit<CardPlan, 'answerLabels' | 'contextFields'> &
    Partial<Pick<CardPlan, 'answerLabels' | 'contextFields'>>,
): CardPlan {
  return {
    ...value,
    answerLabels: value.answerLabels ?? value.answerFields,
    contextFields: value.contextFields ?? [],
  }
}

function model(
  input: DetectionInput,
  value: Omit<ModelConfig, 'modelName' | 'enabled'>,
): ModelConfig {
  return {
    modelName: input.modelName,
    enabled: true,
    ...value,
  }
}

function goetheConfig(input: DetectionInput): ModelConfig | null {
  const source = input.fields.includes('de_word') ? 'de_word' : ''
  const target = input.fields.includes('en_word') ? 'en_word' : ''
  if (!source || !target) return null
  const audio = input.fields.includes('de_tts_audio')
    ? 'de_tts_audio'
    : input.fields.includes('de_audio')
      ? 'de_audio'
      : undefined
  const sourceExampleField = input.fields.includes('de_sentence')
    ? 'de_sentence'
    : undefined
  const targetExampleField = input.fields.includes('en_sentence')
    ? 'en_sentence'
    : undefined
  const noteField = input.fields.includes('en_note') ? 'en_note' : undefined
  return model(input, {
    kind: 'text',
    label: 'German vocabulary',
    confidence: 1,
    plans: [
      plan({
        ord: 0,
        kind: 'text',
        direction: 'forward',
        directionLabel: 'German → English',
        promptField: source,
        answerFields: [target],
        answerLanguages: ['english'],
        sourceExampleField,
        targetExampleField,
        noteField,
        audioField: audio,
        promptAudio: true,
      }),
      plan({
        ord: 1,
        kind: 'text',
        direction: 'reverse',
        directionLabel: 'English → German',
        promptField: target,
        answerFields: [source],
        answerLanguages: ['german'],
        sourceExampleField,
        targetExampleField,
        noteField,
        audioField: audio,
      }),
    ],
  })
}

function namedGermanConfig(input: DetectionInput): ModelConfig | null {
  const fields = new Set(input.fields)
  if (
    fields.has('Text') &&
    fields.has('English') &&
    /cloze/iu.test(input.modelName)
  ) {
    return model(input, {
      kind: 'cloze',
      label: 'Sentence cloze',
      confidence: 1,
      plans: [
        plan({
          ord: 0,
          kind: 'cloze',
          direction: 'reverse',
          directionLabel: 'German cloze',
          answerFields: [],
          answerLanguages: ['german'],
          clozeField: 'Text',
          contextFields: ['English'],
          noteField: fields.has('Grammar') ? 'Grammar' : undefined,
          audioField: fields.has('Audio') ? 'Audio' : undefined,
        }),
      ],
    })
  }
  if (fields.has('English') && fields.has('German') && /production/iu.test(input.modelName)) {
    return model(input, {
      kind: 'text',
      label: 'Sentence production',
      confidence: 1,
      plans: [
        plan({
          ord: 0,
          kind: 'text',
          direction: 'reverse',
          directionLabel: 'English → German',
          promptField: 'English',
          answerFields: ['German'],
          answerLanguages: ['german'],
          contextFields: ['English', 'German'],
          noteField: fields.has('Grammar') ? 'Grammar' : undefined,
          audioField: fields.has('Audio') ? 'Audio' : undefined,
        }),
      ],
    })
  }
  if (fields.has('Audio') && fields.has('German') && /listening/iu.test(input.modelName)) {
    return model(input, {
      kind: 'audio',
      label: 'Listening',
      confidence: 1,
      plans: [
        plan({
          ord: 0,
          kind: 'audio',
          direction: 'forward',
          directionLabel: 'Audio → German',
          answerFields: ['German'],
          answerLanguages: ['german'],
          contextFields: fields.has('English') ? ['English'] : [],
          noteField: fields.has('Grammar') ? 'Grammar' : undefined,
          audioField: 'Audio',
          promptAudio: true,
        }),
      ],
    })
  }
  if (
    fields.has('Infinitiv') &&
    fields.has('Praeteritum') &&
    fields.has('PartizipII')
  ) {
    return model(input, {
      kind: 'multi',
      label: 'Verb forms',
      confidence: 1,
      plans: [
        plan({
          ord: 0,
          kind: 'multi',
          direction: 'reverse',
          directionLabel: 'Meaning → German forms',
          promptField: fields.has('Meaning') ? 'Meaning' : 'Infinitiv',
          answerFields: ['Infinitiv', 'Praeteritum', 'PartizipII'],
          answerLabels: ['Infinitive', 'Präteritum', 'Participle'],
          answerLanguages: ['german', 'german', 'german'],
          contextFields: fields.has('Helper') ? ['Helper'] : [],
          audioField: fields.has('AudioForms') ? 'AudioForms' : undefined,
        }),
      ],
    })
  }
  return null
}

function fallbackGenericConfig(input: DetectionInput): ModelConfig {
  const samples = input.samples
  const front = input.fields.includes('Front') ? 'Front' : input.fields[0] ?? ''
  const back = input.fields.includes('Back') ? 'Back' : input.fields[1] ?? front
  const frontLanguage = inferLanguage(
    front,
    samples.map((card) => field(card, front)),
  )
  const backLanguage = inferLanguage(
    back,
    samples.map((card) => field(card, back)),
  )
  const frontImages = samples.some((card) => imageFilenames(field(card, front)).length)
  const backImages = samples.some((card) => imageFilenames(field(card, back)).length)
  const frontAudio = samples.some((card) => Boolean(audioFilename(field(card, front))))
  const kind: StudyContentKind = frontImages
    ? 'image'
    : frontAudio && !samples.some((card) => plain(field(card, front)))
      ? 'audio'
      : 'text'
  const plans: CardPlan[] = [
    plan({
      ord: 0,
      kind,
      direction: 'forward',
      directionLabel: `${front} → ${back}`,
      promptField: front,
      answerFields: [back],
      answerLanguages: [backLanguage],
      audioField: frontAudio ? front : undefined,
      promptAudio: kind === 'audio',
      imageField: frontImages ? front : undefined,
      answerImageField: backImages ? back : undefined,
    }),
  ]
  for (
    let ord = 1;
    ord < Math.max(1, input.templateCount ?? 1);
    ord += 1
  ) {
    plans.push(
      plan({
        ord,
        kind: backImages ? 'image' : 'text',
        direction: 'reverse',
        directionLabel: `${back} → ${front}`,
        promptField: back,
        answerFields: [front],
        answerLanguages: [frontLanguage],
        audioField: frontAudio ? front : undefined,
        imageField: backImages ? back : undefined,
        answerImageField: frontImages ? front : undefined,
      }),
    )
  }
  return model(input, {
    kind,
    label:
      kind === 'audio'
        ? 'Listening'
        : kind === 'image'
          ? 'Image recall'
          : 'Typed recall',
    confidence: input.fields.length >= 2 ? 0.72 : 0.3,
    plans,
  })
}

const CONTEXT_FIELD =
  /(example|sentence|context|note|hint|grammar|extra|remark|explanation)/iu
const AUDIO_FIELD = /(audio|sound|pronunciation|tts)/iu
const IMAGE_FIELD = /(image|picture|photo)/iu
const MULTI_ANSWER_FIELD =
  /(infinit|preter|praeter|partiz|partic|plural|singular|comparative|superlative|form)/iu

interface TemplateAnalysis {
  fields: string[]
  typedFields: string[]
  clozeFields: string[]
  conditionalFields: string[]
  issues: string[]
}

const BUILTIN_FIELDS = new Set(['FrontSide', 'Tags', 'Subdeck', 'Deck'])
const KNOWN_FILTERS = new Set([
  'type',
  'cloze',
  'hint',
  'text',
  'furigana',
  'kana',
  'kanji',
  'tts',
])

function analyzeTemplate(template: string): TemplateAnalysis {
  const visibleTemplate = template
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, '')
  const fields = new Set<string>()
  const typedFields = new Set<string>()
  const clozeFields = new Set<string>()
  const conditionalFields = new Set<string>()
  const issues = new Set<string>()
  const tokens = [...visibleTemplate.matchAll(/\{\{([^{}]+)\}\}/gu)]

  for (const token of tokens) {
    const raw = token[1].trim()
    const marker = raw[0]
    const expression = ['#', '^', '/'].includes(marker) ? raw.slice(1) : raw
    const parts = expression.split(':').map((part) => part.trim()).filter(Boolean)
    const fieldName = parts.at(-1) ?? ''
    if (!fieldName || BUILTIN_FIELDS.has(fieldName)) continue

    if (marker === '/' || marker === '#'
      || marker === '^') {
      conditionalFields.add(fieldName)
      continue
    }

    fields.add(fieldName)
    const filters = parts.slice(0, -1).map((filter) => filter.toLocaleLowerCase())
    if (filters.includes('type')) typedFields.add(fieldName)
    if (filters.includes('cloze')) clozeFields.add(fieldName)
    for (const filter of filters) {
      if (!KNOWN_FILTERS.has(filter)) issues.add(`Unknown template filter: ${filter}.`)
    }
  }

  if ((visibleTemplate.match(/\{\{/gu)?.length ?? 0) !== tokens.length) {
    issues.add('Template contains an incomplete field expression.')
  }
  if (/<script\b/iu.test(visibleTemplate) && fields.size === 0) {
    issues.add('Script-generated content has no detectable Anki field.')
  }

  return {
    fields: [...fields],
    typedFields: [...typedFields],
    clozeFields: [...clozeFields],
    conditionalFields: [...conditionalFields],
    issues: [...issues],
  }
}

function hasText(input: DetectionInput, fieldName?: string): boolean {
  return Boolean(
    fieldName &&
      input.samples.some((card) => Boolean(plain(field(card, fieldName)))),
  )
}

function hasAudio(input: DetectionInput, fieldName: string): boolean {
  return input.samples.some(
    (card) => audioFilenames(field(card, fieldName)).length > 0,
  )
}

function hasImages(input: DetectionInput, fieldName: string): boolean {
  return input.samples.some(
    (card) => imageFilenames(field(card, fieldName)).length > 0,
  )
}

function languageLabel(language: AnswerLanguage, fallback: string): string {
  if (language === 'german') return 'German'
  if (language === 'english') return 'English'
  return fallback
}

function templatePlans(input: DetectionInput): CardPlan[] {
  const entries = Object.entries(input.templates ?? {})
  if (!entries.length) return []

  return entries.flatMap(([_name, template], ord) => {
    const front = analyzeTemplate(template.Front)
    const back = analyzeTemplate(template.Back)
    const frontFields = front.fields
    const typedFields = front.typedFields
    const backFields = back.fields
    const promptCandidates = frontFields.filter(
      (name) => !AUDIO_FIELD.test(name) && !IMAGE_FIELD.test(name),
    )
    const promptField =
      promptCandidates.find((name) => hasText(input, name)) ??
      promptCandidates[0]
    const backOnly = backFields.filter((name) => !frontFields.includes(name))
    const meaningfulBack = backOnly.filter(
      (name) =>
        !AUDIO_FIELD.test(name) &&
        !IMAGE_FIELD.test(name) &&
        !CONTEXT_FIELD.test(name),
    )
    const answerFields = typedFields.length
      ? typedFields
      : meaningfulBack.length > 1 &&
          meaningfulBack.every((name) => MULTI_ANSWER_FIELD.test(name))
        ? meaningfulBack
        : meaningfulBack.slice(0, 1)
    if (!answerFields.length) return []

    const contextFields = backOnly.filter(
      (name) =>
        !answerFields.includes(name) &&
        !AUDIO_FIELD.test(name) &&
        !IMAGE_FIELD.test(name),
    )
    const mediaFields = [...new Set([...frontFields, ...backFields])]
    const audioFields = mediaFields.filter(
      (name) => AUDIO_FIELD.test(name) || hasAudio(input, name),
    )
    const promptAudioFields = audioFields.filter((name) =>
      frontFields.includes(name),
    )
    const promptImageField = frontFields.find(
      (name) => IMAGE_FIELD.test(name) || hasImages(input, name),
    )
    const answerImageField = backOnly.find(
      (name) => IMAGE_FIELD.test(name) || hasImages(input, name),
    )
    const promptLanguage = inferLanguage(
      promptField ?? '',
      input.samples.map((card) => field(card, promptField)),
    )
    const answerLanguages = answerFields.map((name) =>
      inferLanguage(name, input.samples.map((card) => field(card, name))),
    )
    const clozeField = typedFields.find((name) => front.clozeFields.includes(name))
    const kind: StudyContentKind =
      clozeField
        ? 'cloze'
        : answerFields.length > 1
        ? 'multi'
        : promptAudioFields.length && !promptField
          ? 'audio'
          : promptImageField && !promptField
            ? 'image'
            : 'text'
    const promptLabel = languageLabel(
      promptLanguage,
      promptField ?? (kind === 'audio' ? 'Audio' : 'Prompt'),
    )
    const answerLabel = languageLabel(answerLanguages[0], answerFields[0])

    return [
      plan({
        ord,
        kind,
        direction:
          promptLanguage === 'english' && answerLanguages[0] === 'german'
            ? 'reverse'
            : 'forward',
        directionLabel: `${promptLabel} → ${answerLabel}`,
        promptField,
        clozeField,
        answerFields,
        answerLanguages,
        answerMode: answerFields.length > 1 ? 'parts' : 'alternatives',
        contextFields,
        audioField: audioFields[0],
        audioFields,
        promptAudio: kind === 'audio',
        imageField: promptImageField,
        answerImageField,
      }),
    ]
  })
}

function genericConfig(input: DetectionInput): ModelConfig {
  const plans = templatePlans(input)
  if (!plans.length) return fallbackGenericConfig(input)
  const templateIssues = Object.values(input.templates ?? {}).flatMap(
    (template) => [
      ...analyzeTemplate(template.Front).issues,
      ...analyzeTemplate(template.Back).issues,
    ],
  )
  const kind = plans.some((item) => item.kind === 'multi')
    ? 'multi'
    : plans.some((item) => item.kind === 'audio')
      ? 'audio'
      : plans.some((item) => item.kind === 'image')
        ? 'image'
        : 'text'
  const typedTemplate = Object.values(input.templates ?? {}).some((template) =>
    /\{\{type:/iu.test(template.Front),
  )
  return model(input, {
    kind,
    label:
      kind === 'audio'
        ? 'Listening'
        : kind === 'image'
          ? 'Image recall'
          : kind === 'multi'
            ? 'Multi-part recall'
            : 'Typed recall',
    confidence: templateIssues.length ? 0.58 : typedTemplate ? 0.94 : 0.82,
    plans,
  })
}

export function detectModelConfig(input: DetectionInput): ModelConfig {
  return (
    goetheConfig(input) ??
    namedGermanConfig(input) ??
    genericConfig(input)
  )
}

export function buildDeckConfig(
  deckName: string,
  inputs: Omit<DetectionInput, 'deckName'>[],
): {
  config: DeckConfig
  compatibility: ModelCompatibility[]
} {
  const models = inputs.map((input) =>
    detectModelConfig({ ...input, deckName }),
  )
  const compatibility = models.map((config, index) => {
    const input = inputs[index]
    const sample = input.samples[0]
    const adapted = sample ? adaptCard(sample, {
      version: 2,
      deckName,
      includeSubdecks: true,
      models: [config],
    }) : null
    const templateIssues = [
      ...new Set(
        Object.values(input.templates ?? {}).flatMap((template) => [
          ...analyzeTemplate(template.Front).issues,
          ...analyzeTemplate(template.Back).issues,
        ]),
      ),
    ]
    const status =
      config.confidence >= 0.85 && !templateIssues.length
        ? 'ready'
        : config.confidence >= 0.5
          ? 'review'
          : 'unsupported'
    if (status === 'unsupported') config.enabled = false
    const promptFields = [
      ...new Set(
        config.plans
          .map((item) => item.promptField ?? item.clozeField)
          .filter((value): value is string => Boolean(value)),
      ),
    ]
    const answerFields = [
      ...new Set(config.plans.flatMap((item) => item.answerFields)),
    ]
    const mediaFields = [
      ...new Set(
        config.plans
          .flatMap((item) => [
            ...(item.audioFields ?? []),
            item.audioField,
            item.imageField,
            item.answerImageField,
          ])
          .filter((value): value is string => Boolean(value)),
      ),
    ]
    const issues: string[] = [...templateIssues]
    if (!config.plans.length) issues.push('No usable card template detected.')
    if (!adapted) issues.push('Sample card produced no typed answer.')
    if (adapted?.prompt && adapted.prompt === adapted.canonicalAnswer) {
      issues.push('Prompt and answer are identical in the sample.')
    }
    const templateCount =
      Object.keys(input.templates ?? {}).length || input.templateCount || 0
    if (templateCount > config.plans.length) {
      issues.push(
        `${templateCount - config.plans.length} template(s) could not be mapped.`,
      )
    }
    return {
      modelName: config.modelName,
      status,
      kind: config.kind,
      label: config.label,
      confidence: config.confidence,
      noteCount: input.noteCount,
      diagnostics: {
        fields: input.fields,
        templates: Object.keys(input.templates ?? {}),
        promptFields,
        answerFields,
        mediaFields,
        issues,
      },
      reason:
        status === 'ready'
          ? 'Prompt and answer fields detected.'
          : status === 'review'
            ? issues[0] ?? 'Mapping is plausible; check preview.'
            : issues[0] ?? 'No typed answer could be detected.',
      previewPrompt: adapted?.prompt || (adapted?.promptAudioFilename ? 'Audio prompt' : ''),
      previewAnswer: adapted?.answerParts?.map((part) => part.canonicalAnswer).join(' · ') ??
        adapted?.canonicalAnswer ??
        '',
    } satisfies ModelCompatibility
  })
  return {
    config: {
      version: 2,
      deckName,
      includeSubdecks: true,
      models,
    },
    compatibility,
  }
}

export function configFromLegacy(
  deckName: string,
  mapping: FieldMapping,
): DeckConfig {
  const modelName = mapping.modelName
  return {
    version: 2,
    deckName,
    includeSubdecks: true,
    models: [
      {
        modelName,
        enabled: true,
        kind: 'text',
        label: 'German vocabulary',
        confidence: 1,
        plans: [
          plan({
            ord: mapping.forwardOrd,
            kind: 'text',
            direction: 'forward',
            directionLabel: `${mapping.sourceLabel} → ${mapping.targetLabel}`,
            promptField: mapping.sourceWord,
            answerFields: [mapping.targetMeaning],
            answerLanguages: ['english'],
            sourceExampleField: mapping.sourceExample,
            targetExampleField: mapping.targetExample,
            noteField: mapping.note,
            audioField: mapping.audio,
            promptAudio: true,
          }),
          plan({
            ord: mapping.reverseOrd,
            kind: 'text',
            direction: 'reverse',
            directionLabel: `${mapping.targetLabel} → ${mapping.sourceLabel}`,
            promptField: mapping.targetMeaning,
            answerFields: [mapping.sourceWord],
            answerLanguages: ['german'],
            sourceExampleField: mapping.sourceExample,
            targetExampleField: mapping.targetExample,
            noteField: mapping.note,
            audioField: mapping.audio,
          }),
        ],
      },
    ],
  }
}

export function normalizeConfig(
  deckName: string,
  config: StudyConfig,
): DeckConfig {
  return 'version' in config && config.version === 2
    ? config
    : configFromLegacy(deckName, config as FieldMapping)
}

export function reconcileConfig(
  stored: DeckConfig | null,
  detected: DeckConfig | null | undefined,
): DeckConfig | null {
  if (!detected) return stored
  if (!stored) return detected
  const storedByModel = new Map(
    stored.models.map((modelConfig) => [modelConfig.modelName, modelConfig]),
  )
  return {
    ...detected,
    models: detected.models.map((modelConfig) => {
      const previous = storedByModel.get(modelConfig.modelName)
      if (!previous) return modelConfig
      return modelConfig.confidence >= 0.85 || !stored.customized
        ? { ...modelConfig, enabled: previous.enabled }
        : previous
    }),
  }
}

function clozeContent(value: string, ord: number) {
  const target = ord + 1
  const answers: string[] = []
  const prompt = value.replace(
    /\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/giu,
    (_whole, number: string, answer: string, hint: string | undefined) => {
      if (Number(number) !== target) return answer
      answers.push(plain(answer))
      return hint ? `[${plain(hint)}]` : '…'
    },
  )
  return { prompt: plain(prompt), answers }
}

function details(card: AnkiCardInfo, plan: CardPlan): StudyDetail[] {
  return (plan.contextFields ?? [])
    .map((name) => ({ label: name, value: plain(field(card, name)) }))
    .filter((item) => item.value)
}

function answerParts(card: AnkiCardInfo, plan: CardPlan): AnswerPart[] {
  if (plan.kind === 'cloze' && plan.clozeField) {
    const content = clozeContent(field(card, plan.clozeField), card.ord)
    return content.answers.map((answer, index) => ({
      id: `cloze-${index}`,
      label: 'Missing text',
      canonicalAnswer: answer,
      acceptedAnswers: germanAnswerVariants(answer),
      language: plan.answerLanguages[index] ?? 'german',
      required: true,
      mode: 'single',
    }))
  }

  const createPart = (name: string, index: number): AnswerPart | null => {
      const language = plan.answerLanguages[index] ?? 'plain'
      const acceptedAnswers = variants(
        field(card, name),
        language,
        plan.answerSeparators,
      )
      const part = {
        id: `${name}-${index}`,
        label: plan.answerLabels?.[index] ?? name,
        canonicalAnswer: acceptedAnswers[0] ?? plain(field(card, name)),
        acceptedAnswers,
        language,
        required: !plan.optionalAnswerFields?.includes(name),
        mode: 'single' as const,
      }
      return part.canonicalAnswer ? part : null
  }

  if (plan.answerMode === 'alternatives') {
    const parts = plan.answerFields
      .map(createPart)
      .filter((part): part is AnswerPart => Boolean(part))
    if (!parts.length) return []
    return [{
      ...parts[0],
      id: 'alternatives',
      label: plan.answerLabels?.[0] ?? 'Answer',
      acceptedAnswers: [
        ...new Set(parts.flatMap((part) => part.acceptedAnswers)),
      ],
      required: parts.every((part) => part.required),
    }]
  }

  if (plan.answerMode === 'unordered') {
    const separators = plan.answerSeparators?.length
      ? plan.answerSeparators
      : [',', ';', '/', '\n']
    const items = plan.answerFields.flatMap((name, index) => {
      const language = plan.answerLanguages[index] ?? 'plain'
      const pattern = new RegExp(
        `[${separators.map((value) => value.replace(/[\\\-\]]/gu, '\\$&')).join('')}]`,
        'gu',
      )
      return plain(field(card, name))
        .split(pattern)
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => ({
          canonicalAnswer: answerVariants(value, language)[0] ?? value,
          acceptedAnswers: answerVariants(value, language),
        }))
    })
    if (!items.length) return []
    return [{
      id: 'unordered',
      label: plan.answerLabels?.[0] ?? 'Answer',
      canonicalAnswer: items.map((item) => item.canonicalAnswer).join(', '),
      acceptedAnswers: items.flatMap((item) => item.acceptedAnswers),
      language: plan.answerLanguages[0] ?? 'plain',
      required: true,
      mode: 'unordered',
      separators,
      items,
    }]
  }

  return plan.answerFields
    .map(createPart)
    .filter((part): part is AnswerPart => Boolean(part))
}

export function adaptCard(
  card: AnkiCardInfo,
  configuration: StudyConfig,
): StudyCard | null {
  const config = normalizeConfig(card.deckName, configuration)
  const model = config.models.find(
    (item) => item.enabled && item.modelName === card.modelName,
  )
  const selectedPlan =
    model?.plans.find((item) => item.ord === card.ord) ??
    (model?.plans.length === 1 ? model.plans[0] : undefined)
  if (!model || !selectedPlan) return null

  const parts = answerParts(card, selectedPlan)
  if (!parts.length) return null
  const cloze = selectedPlan.clozeField
    ? clozeContent(field(card, selectedPlan.clozeField), card.ord)
    : null
  const promptRaw = field(card, selectedPlan.promptField)
  const promptImages = imageFilenames(
    field(card, selectedPlan.imageField ?? selectedPlan.promptField),
  )
  const answerImages = imageFilenames(
    field(card, selectedPlan.answerImageField),
  )
  const configuredAudioFields = selectedPlan.audioFields?.length
    ? selectedPlan.audioFields
    : selectedPlan.audioField
      ? [selectedPlan.audioField]
      : []
  const audioFiles = [
    ...new Set(
      configuredAudioFields.flatMap((name) =>
        audioFilenames(field(card, name)),
      ),
    ),
  ]
  const audio = audioFiles[0] ?? null
  const itemDetails = details(card, selectedPlan)
  const note = plain(field(card, selectedPlan.noteField))
  const canonicalAnswer = parts.map((part) => part.canonicalAnswer).join(' · ')

  return {
    cardId: card.cardId,
    noteId: card.note,
    modelName: card.modelName,
    direction: selectedPlan.direction,
    directionLabel: selectedPlan.directionLabel,
    prompt: cloze?.prompt ?? plain(promptRaw),
    canonicalAnswer,
    acceptedAnswers: parts[0]?.acceptedAnswers ?? [],
    answerParts: parts,
    contentKind: selectedPlan.kind,
    promptAudioFilename: selectedPlan.promptAudio ? audio : null,
    promptAudioFilenames: selectedPlan.promptAudio ? audioFiles : [],
    promptImageFilenames: promptImages,
    answerImageFilenames: answerImages,
    details: itemDetails,
    sourceWord:
      selectedPlan.direction === 'forward'
        ? plain(promptRaw)
        : parts[0]?.canonicalAnswer ?? '',
    targetMeaning:
      selectedPlan.direction === 'forward'
        ? parts[0]?.canonicalAnswer ?? ''
        : plain(promptRaw),
    sourceExample: plain(field(card, selectedPlan.sourceExampleField)),
    targetExample: plain(field(card, selectedPlan.targetExampleField)),
    note,
    audioFilename: selectedPlan.promptAudio ? null : audio,
    audioFilenames: selectedPlan.promptAudio ? [] : audioFiles,
    interval: card.interval,
    type: card.type,
    queue: card.queue,
    due: card.due,
    reps: card.reps,
    lapses: card.lapses,
  }
}
