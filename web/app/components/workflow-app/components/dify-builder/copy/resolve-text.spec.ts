import assert from 'node:assert/strict'
import { createInstance } from 'i18next'
import languages from '@/i18n/languages'
import english from '@/i18n/locales/en-US/dify-builder.json'
import japanese from '@/i18n/locales/ja-JP/dify-builder.json'
import chinese from '@/i18n/locales/zh-Hans/dify-builder.json'
import { resolveBuilderText } from './resolve-text'
import { builderSceneKeys } from './scene-keys'

const catalogs = import.meta.glob<typeof english>('/i18n/locales/*/dify-builder.json', {
  eager: true,
  import: 'default',
})

describe('Builder scene presentation', () => {
  const instance = createInstance()
  beforeAll(async () => {
    await instance.init({
      lng: 'en-US',
      fallbackLng: 'en-US',
      keySeparator: false,
      interpolation: { escapeValue: false },
      resources: {
        'en-US': { difyBuilder: english },
        'zh-Hans': { difyBuilder: chinese },
        'ja-JP': { difyBuilder: japanese },
      },
    })
  })

  it.each([
    ['en-US', 'Approve plan'],
    ['zh-Hans', '批准计划'],
    ['ja-JP', '計画を承認'],
  ])('renders the same scene in %s without changing the global language', (locale, expected) => {
    const t = instance.getFixedT(locale, ['difyBuilder'])
    expect(resolveBuilderText({ type: 'copy', id: 'actions.approvePlan' }, t)).toBe(expected)
    expect(instance.language).toBe('en-US')
  })

  it('preserves literal collisions and interpolates parameters byte for byte', () => {
    const t = instance.getFixedT('zh-Hans', ['difyBuilder'])
    for (const text of ['Goal', 'Yes', 'Review', '{{name}}', '<tag>'])
      expect(resolveBuilderText(text, t)).toBe(text)
    for (const name of ['Goal <tag> {{name}}', '$t(copy.values.yes)', '{{count}}']) {
      expect(resolveBuilderText({ type: 'copy', id: 'model.changed', params: { name } }, t)).toBe(
        `模型已更改为 ${name}`,
      )
    }
    expect(
      resolveBuilderText(
        {
          type: 'parts',
          parts: [{ type: 'copy', id: 'repair.proposedFix' }, '\nGoal: dynamic diagnosis'],
        },
        t,
      ),
    ).toBe('建议的修复：\nGoal: dynamic diagnosis')
  })

  it.each(languages.languages.map(({ value }) => value))(
    'keeps the complete %s catalog with unchanged parameter names',
    (locale) => {
      const catalog = catalogs[`/i18n/locales/${locale}/dify-builder.json`]
      assert(catalog, `Missing difyBuilder catalog for ${locale}`)
      expect(Object.keys(catalog)).toEqual(Object.keys(english))
      expect(Object.keys(catalog)).toEqual(Object.keys(catalog).sort())
      const params = (text: string) =>
        [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort()
      for (const key of Object.values(builderSceneKeys)) {
        expect(catalog[key]).toBeTruthy()
        expect(params(catalog[key])).toEqual(params(english[key]))
      }
    },
  )
})
