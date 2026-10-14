import { resolveInteractionLocale } from '../locale'

describe('Builder interaction locale matching', () => {
  it.each([
    ['en', 'en-US'],
    ['en-GB', 'en-US'],
    ['en_US', 'en-US'],
    ['ja', 'ja-JP'],
    ['ja_JP', 'ja-JP'],
    ['fr', 'fr-FR'],
    ['fr-CA', 'fr-FR'],
    ['zh', 'zh-Hans'],
    ['zh-CN', 'zh-Hans'],
    ['zh-SG', 'zh-Hans'],
    ['ZH-hans', 'zh-Hans'],
    ['zh_Hans', 'zh-Hans'],
    ['zh-TW', 'zh-Hant'],
    ['zh-HK', 'zh-Hant'],
    ['zh-Hant-HK', 'zh-Hant'],
    ['zh-Hant-CN', 'zh-Hant'],
    ['pt', 'pt-BR'],
  ] as const)('matches %s to %s', (language, expected) => {
    expect(resolveInteractionLocale(language, 'de-DE')).toBe(expected)
  })

  it.each(['', 'und', 'en--US', 'unsupported', 'sw', 'en-Cyrl'])(
    'falls back to the account locale for %s',
    (language) => {
      expect(resolveInteractionLocale(language, 'zh-Hant')).toBe('zh-Hant')
    },
  )
})
