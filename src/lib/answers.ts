import type {
  AnswerLanguage as DomainAnswerLanguage,
  AnswerPart,
  AnswerResult,
} from './domain'

export type AnswerLanguage = 'german' | 'english'
export type AnswerAttemptPhase = 'answering' | 'correction'

const ARTICLE_ALTERNATIVE =
  /^(der|die|das|ein|eine)\/(der|die|das|ein|eine)\s+(.+)$/iu
const GENDER_ARTICLE = /^(der|die|das)$/iu
const GENDER_ARTICLE_LIST =
  /^(der|die|das)(?:\s*\/\s*(der|die|das))*$/iu

export type GermanGenderArticle = 'der' | 'die' | 'das'

export interface GermanArticleHeadword {
  articles: GermanGenderArticle[]
  word: string
}

export function splitGermanArticle(
  value: string,
): GermanArticleHeadword | null {
  const match = value
    .trim()
    .match(/^((?:der|die|das)(?:\s*\/\s*(?:der|die|das))*)\s+(.+)$/iu)
  if (!match) return null
  const articles = match[1]
    .split(/\s*\/\s*/u)
    .map((article) => article.toLocaleLowerCase('de-DE'))
    .filter((article): article is GermanGenderArticle =>
      GENDER_ARTICLE.test(article),
    )
  return articles.length ? { articles, word: match[2] } : null
}

export function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/giu, ' ')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
}

export function stripAudio(value: string): string {
  return value.replace(/\[sound:[^\]]+\]/giu, '').trim()
}

export function audioFilename(value: string): string | null {
  return audioFilenames(value)[0] ?? null
}

export function audioFilenames(value: string): string[] {
  return unique(
    [...value.matchAll(/\[sound:([^\]]+)\]/giu)]
      .map((match) => match[1])
      .filter(
        (filename) =>
          filename &&
          !filename.includes('/') &&
          !filename.includes('\\'),
      ),
  )
}

export function imageFilenames(value: string): string[] {
  return [...value.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/giu)]
    .map((match) => match[1])
    .filter(
      (filename) =>
        filename &&
        !filename.includes('/') &&
        !filename.includes('\\') &&
        !filename.startsWith('data:'),
    )
}

function cleanupSource(value: string): string {
  return stripAudio(stripHtml(value))
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .trim()
}

function expandOptionalGroups(value: string): string[] {
  const match = value.match(/^(.*?)\(([^()]*)\)(.*)$/u)
  if (!match) return [value]

  const [, before, optional, after] = match
  const without = `${before}${after}`.replace(/\s+/gu, ' ').trim()
  const withGroup = `${before}${optional}${after}`.replace(/\s+/gu, ' ').trim()

  return [
    ...expandOptionalGroups(without),
    ...expandOptionalGroups(withGroup),
  ]
}

function splitTopLevel(value: string, separators: Set<string>): string[] {
  const result: string[] = []
  let current = ''
  let depth = 0

  for (const character of value) {
    if (character === '(') depth += 1
    if (character === ')') depth = Math.max(0, depth - 1)

    if (depth === 0 && separators.has(character)) {
      if (current.trim()) result.push(current.trim())
      current = ''
      continue
    }

    current += character
  }

  if (current.trim()) result.push(current.trim())
  return result
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function germanBase(value: string): string {
  const withoutGrammarMetadata = value
    .replace(/\((?:pl|sing|ugs|fam|form)\.?\)/giu, '')
    .trim()
  const parentheticalArticle = withoutGrammarMetadata.match(
    /^(.+?)\s*\(((?:der|die|das)(?:\s*\/\s*(?:der|die|das))*)\)$/iu,
  )
  if (parentheticalArticle && GENDER_ARTICLE_LIST.test(parentheticalArticle[2])) {
    return `${parentheticalArticle[2]} ${parentheticalArticle[1]}`
  }
  const trailingArticle = withoutGrammarMetadata.match(
    /^(.+?),\s*((?:der|die|das)(?:\s*\/\s*(?:der|die|das))*)$/iu,
  )
  if (trailingArticle && GENDER_ARTICLE_LIST.test(trailingArticle[2])) {
    return `${trailingArticle[2]} ${trailingArticle[1]}`
  }

  return splitTopLevel(withoutGrammarMetadata, new Set([',']))[0] ?? ''
}

export function germanAnswerVariants(raw: string): string[] {
  const base = germanBase(cleanupSource(raw))
  const genderedHeadword = splitGermanArticle(base)
  if (genderedHeadword && genderedHeadword.articles.length > 1) {
    return genderedHeadword.articles.map(
      (article) => `${article} ${genderedHeadword.word}`,
    )
  }
  const articleMatch = base.match(ARTICLE_ALTERNATIVE)

  const slashVariants = articleMatch
    ? [
        `${articleMatch[1]} ${articleMatch[3]}`,
        `${articleMatch[2]} ${articleMatch[3]}`,
      ]
    : splitTopLevel(base, new Set(['/']))

  return unique(slashVariants.flatMap(expandOptionalGroups))
}

export function englishAnswerVariants(raw: string): string[] {
  const base = cleanupSource(raw)
  const alternatives = splitTopLevel(base, new Set(['/', ';']))
  return unique(alternatives.flatMap(expandOptionalGroups))
}

export function answerVariants(
  raw: string,
  language: DomainAnswerLanguage,
  separators?: string[],
): string[] {
  if (!separators?.length) {
    if (language === 'german') return germanAnswerVariants(raw)
    if (language === 'english') return englishAnswerVariants(raw)
    const normalized = cleanupSource(raw)
    return normalized ? [normalized] : []
  }
  const alternatives = splitTopLevel(
    cleanupSource(raw),
    new Set(separators.flatMap((separator) => [...separator])),
  )
  return unique(alternatives.flatMap(expandOptionalGroups))
}

export function foldAnswer(value: string, german = false): string {
  let folded = cleanupSource(value).toLocaleLowerCase()

  if (german) {
    folded = folded
      .replace(/ä/gu, 'ae')
      .replace(/ö/gu, 'oe')
      .replace(/ü/gu, 'ue')
      .replace(/ß/gu, 'ss')
  }

  return folded
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

export function checkAnswer(
  input: string,
  rawExpected: string,
  language: AnswerLanguage,
): AnswerResult {
  const acceptedAnswers =
    language === 'german'
      ? germanAnswerVariants(rawExpected)
      : englishAnswerVariants(rawExpected)
  const foldedInput = foldAnswer(input, language === 'german')
  const correct = acceptedAnswers.some(
    (answer) => foldAnswer(answer, language === 'german') === foldedInput,
  )

  return {
    correct,
    canonicalAnswer: acceptedAnswers[0] ?? cleanupSource(rawExpected),
    acceptedAnswers,
  }
}

export function matchesAnyAnswer(
  input: string,
  acceptedAnswers: string[],
  language: AnswerLanguage,
): boolean {
  const foldedInput = foldAnswer(input, language === 'german')
  return acceptedAnswers.some(
    (answer) => foldAnswer(answer, language === 'german') === foldedInput,
  )
}

export function matchesAnswerPart(input: string, part: AnswerPart): boolean {
  if (!part.required && !input.trim()) return true
  if (part.mode !== 'unordered' || !part.items?.length) {
    return matchesAnyAnswer(
      input,
      part.acceptedAnswers,
      part.language === 'plain' ? 'english' : part.language,
    )
  }

  const separators = part.separators?.length
    ? part.separators
    : [',', ';', '/', '\n']
  const provided = splitTopLevel(
    cleanupSource(input),
    new Set(separators.flatMap((separator) => [...separator])),
  )
  if (provided.length !== part.items.length) return false

  const remaining = [...provided]
  return part.items.every((item) => {
    const index = remaining.findIndex((candidate) =>
      matchesAnyAnswer(
        candidate,
        item.acceptedAnswers,
        part.language === 'plain' ? 'english' : part.language,
      ),
    )
    if (index < 0) return false
    remaining.splice(index, 1)
    return true
  })
}

export function submissionDecision(
  phase: AnswerAttemptPhase,
  input: string,
  acceptedAnswers: string[],
  language: AnswerLanguage,
):
  | { action: 'show-correction' }
  | { action: 'grade'; ease: 1 | 3; outcome: 'correct' | 'incorrect' } {
  const correct = matchesAnyAnswer(input, acceptedAnswers, language)
  if (phase === 'answering' && !correct) return { action: 'show-correction' }
  return {
    action: 'grade',
    ease: correct ? 3 : 1,
    outcome: correct ? 'correct' : 'incorrect',
  }
}
