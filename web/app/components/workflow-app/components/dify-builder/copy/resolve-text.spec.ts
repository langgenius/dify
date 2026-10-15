import assert from 'node:assert/strict'
import { createInstance } from 'i18next'
import languages from '@/i18n/languages'
import english from '@/i18n/locales/en-US/dify-builder.json'
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
      resources: Object.fromEntries(
        languages.languages.map(({ value }) => {
          const catalog = catalogs[`/i18n/locales/${value}/dify-builder.json`]
          assert(catalog, `Missing difyBuilder catalog for ${value}`)
          return [value, { difyBuilder: catalog }]
        }),
      ),
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
      const pluralKeys = new Set(
        new Intl.PluralRules(locale)
          .resolvedOptions()
          .pluralCategories.map((form) => `plan.stepCount_${form}`),
      )
      expect(
        Object.keys(catalog).filter((key) => Object.hasOwn(english, key) || !pluralKeys.has(key)),
      ).toEqual(Object.keys(english))
      expect(Object.keys(catalog)).toEqual(Object.keys(catalog).sort())
      const params = (text: string) =>
        [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort()
      for (const key of Object.values(builderSceneKeys)) {
        expect(catalog[key]).toBeTruthy()
        expect(params(catalog[key])).toEqual(params(english[key]))
      }
      for (const [key, value] of Object.entries(catalog)) {
        if (key.startsWith('plan.stepCount_')) expect(params(value)).toEqual(['count'])
      }
    },
  )

  it.each([
    ['en-US', 1, '1 step'],
    ['en-US', 4, '4 steps'],
    ['ru-RU', 4, '4 шага'],
    ['ru-RU', 5, '5 шагов'],
    ['pl-PL', 2, '2 kroki'],
    ['sl-SI', 2, '2 koraka'],
    ['ar-TN', 3, '3 خطوات'],
    ['zh-Hans', 4, '4 步'],
  ])('uses the %s plural form for %i plan steps', (locale, count, expected) => {
    const t = instance.getFixedT(locale, ['difyBuilder'])
    expect(t(($) => $['plan.stepCount'], { count })).toBe(expected)
  })
})
