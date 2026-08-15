import { describe, expect, it } from 'vite-plus/test'
import { filterTemplatesForLocale } from '../template-language'

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
