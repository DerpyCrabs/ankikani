import { describe, expect, it } from 'vitest'
import {
  checkAnswer,
  englishAnswerVariants,
  foldAnswer,
  germanAnswerVariants,
  matchesAnyAnswer,
  submissionDecision,
} from '../src/lib/answers'

describe('German answer parsing', () => {
  it('requires the declared noun article and ignores plural metadata', () => {
    expect(checkAnswer('die Ansage', 'die Ansage, -n', 'german').correct).toBe(
      true,
    )
    expect(checkAnswer('Ansage', 'die Ansage, -n', 'german').correct).toBe(false)
    expect(checkAnswer('der Ansage', 'die Ansage, -n', 'german').correct).toBe(
      false,
    )
  })

  it('expands alternative declared articles', () => {
    expect(germanAnswerVariants('der/die Bekannte, -n')).toEqual([
      'der Bekannte',
      'die Bekannte',
    ])
  })

  it('expands optional leading and suffix groups', () => {
    expect(germanAnswerVariants('(sich) anziehen')).toEqual([
      'anziehen',
      'sich anziehen',
    ])
    expect(germanAnswerVariants('gern(e)')).toEqual(['gern', 'gerne'])
  })

  it('accepts German transliterations', () => {
    expect(checkAnswer('die Strasse', 'die Straße', 'german').correct).toBe(true)
    expect(checkAnswer('der Kaese', 'der Käse', 'german').correct).toBe(true)
    expect(foldAnswer('FÜR', true)).toBe('fuer')
  })

  it('removes punctuation and normalizes whitespace and case', () => {
    expect(checkAnswer('  ZUM beispiel ', 'zum Beispiel/z. B.', 'german').correct)
      .toBe(true)
    expect(checkAnswer('z b', 'zum Beispiel/z. B.', 'german').correct).toBe(true)
  })
})

describe('English answer parsing', () => {
  it('expands explicit slash and semicolon alternatives', () => {
    expect(englishAnswerVariants('information/details')).toEqual([
      'information',
      'details',
    ])
    expect(englishAnswerVariants('wrong; incorrect')).toEqual([
      'wrong',
      'incorrect',
    ])
  })

  it('treats parenthetical language as optional', () => {
    expect(englishAnswerVariants('to be (switched) on')).toEqual([
      'to be on',
      'to be switched on',
    ])
  })

  it('does not infer unlisted synonyms', () => {
    expect(checkAnswer('notice', 'announcement', 'english').correct).toBe(false)
  })

  it('matches every generated alternative in a study card', () => {
    expect(
      matchesAnyAnswer('details', ['information', 'details'], 'english'),
    ).toBe(true)
  })
})

describe('typed answer state machine', () => {
  it('shows correction without grading after first wrong answer', () => {
    expect(
      submissionDecision('answering', 'wrong', ['announcement'], 'english'),
    ).toEqual({ action: 'show-correction' })
  })

  it('grades a correct retype as Good', () => {
    expect(
      submissionDecision('correction', 'announcement', ['announcement'], 'english'),
    ).toEqual({ action: 'grade', ease: 3, outcome: 'correct' })
  })

  it('grades a second wrong submission as Again', () => {
    expect(
      submissionDecision('correction', 'wrong', ['announcement'], 'english'),
    ).toEqual({ action: 'grade', ease: 1, outcome: 'incorrect' })
  })
})
