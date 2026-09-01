import { describe, expect, it } from 'vite-plus/test'
import {
  filterTemplatesForLocale,
  getTemplateCollectionText,
  parseListParam,
  resolveTemplateSearchLanguages,
} from '../template-language'

const template = (id: string, preferredLanguages?: string[]) => ({
  id,
  preferred_languages: preferredLanguages,
})

const ids = (templates: { id: string }[]) => templates.map(({ id }) => id)

describe('filterTemplatesForLocale', () => {
  it('keeps templates matching the requested language prefix', () => {
    const templates = [
      template('en', ['en-US']),
      template('zh', ['zh-Hans']),
      template('ja', ['ja-JP']),
    ]

    expect(ids(filterTemplatesForLocale(templates, 'zh-Hans'))).toEqual(['zh'])
    expect(ids(filterTemplatesForLocale(templates, 'en-US'))).toEqual(['en'])
  })

  it('matches unrelated locales instead of collapsing them into "other"', () => {
    const templates = [
      template('en', ['en-US']),
      template('de', ['de-DE']),
      template('fr', ['fr-FR']),
    ]

    expect(ids(filterTemplatesForLocale(templates, 'de-DE'))).toEqual(['de'])
  })

  it('falls back to English templates when nothing matches the requested language', () => {
    const templates = [
      template('en-1', ['en-US']),
      template('en-2', ['en-GB']),
      template('ja', ['ja-JP']),
    ]

    expect(ids(filterTemplatesForLocale(templates, 'de-DE'))).toEqual(['en-1', 'en-2'])
  })

  it('falls back to the unfiltered list when neither the locale nor English matches', () => {
    const templates = [template('zh', ['zh-Hans']), template('ja', ['ja-JP'])]

    expect(ids(filterTemplatesForLocale(templates, 'de-DE'))).toEqual(['zh', 'ja'])
  })

  it('always keeps language-agnostic templates', () => {
    const templates = [
      template('agnostic-none'),
      template('agnostic-empty', []),
      template('de', ['de-DE']),
    ]

    expect(ids(filterTemplatesForLocale(templates, 'de-DE'))).toEqual([
      'agnostic-none',
      'agnostic-empty',
      'de',
    ])
  })

  it('normalizes underscore locales', () => {
    const templates = [template('zh', ['zh_Hans']), template('en', ['en_US'])]

    expect(ids(filterTemplatesForLocale(templates, 'zh_Hans'))).toEqual(['zh'])
  })
})

describe('getTemplateCollectionText', () => {
  it('uses the matching collection translation and falls back to English', () => {
    const label = {
      en_US: 'Featured',
      zh_Hans: '精选',
      zh_Hant: '精選',
      ja_JP: '注目',
    }

    expect(getTemplateCollectionText(label, 'zh-Hant')).toBe('精選')
    expect(getTemplateCollectionText(label, 'de-DE')).toBe('Featured')
  })

  it('falls back to the first available translation when English is missing', () => {
    expect(getTemplateCollectionText({ ja_JP: '注目' }, 'de-DE')).toBe('注目')
    expect(getTemplateCollectionText({}, 'de-DE')).toBe('')
  })
})

describe('parseListParam', () => {
  it('normalizes undefined, comma-separated, and array language values', () => {
    expect(parseListParam(undefined)).toEqual([])
    expect(parseListParam('en,zh-Hans')).toEqual(['en', 'zh-Hans'])
    expect(parseListParam(['ja', ' other '])).toEqual(['ja', 'other'])
  })
})

describe('resolveTemplateSearchLanguages', () => {
  it('uses the explicit filter when the visitor picked languages', () => {
    expect(resolveTemplateSearchLanguages(['ja'], 'zh-Hans')).toEqual(['ja'])
  })

  it('maps UI locales onto catalog language values when the filter is unset', () => {
    expect(resolveTemplateSearchLanguages([], 'en-US')).toEqual(['en'])
    expect(resolveTemplateSearchLanguages([], 'zh-Hans')).toEqual(['zh-Hans'])
    expect(resolveTemplateSearchLanguages([], 'zh_Hans')).toEqual(['zh-Hans'])
    expect(resolveTemplateSearchLanguages([], 'ja-JP')).toEqual(['ja'])
  })

  it('keeps unmatched locale prefixes so pagination is not mixed-language', () => {
    expect(resolveTemplateSearchLanguages([], 'de-DE')).toEqual(['de'])
  })
})
