import assert from 'node:assert/strict'
import { getTranslationSourceKey } from '@dify/tooling/i18n-plurals'
import { createInstance } from 'i18next'
import languages from '@/i18n/languages'
import english from '@/i18n/locales/en-US/dify-builder.json'
import { resolveBuilderText } from './resolve-text'
import { builderSceneKeys } from './scene-keys'

const sourceCatalog: Record<string, string> = english
const sourceKeys = new Set(Object.keys(english))
const pluralBases = Object.keys(english)
  .filter((key) => key.startsWith('copy.') && key.endsWith('_other'))
  .map((key) => key.slice(0, -'_other'.length))

const catalogs = import.meta.glob<Record<string, string>>('/i18n/locales/*/dify-builder.json', {
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
      expect(
        Object.keys(catalog).filter(
          (key) => sourceKeys.has(key) || !getTranslationSourceKey(sourceKeys, key, locale),
        ),
      ).toEqual(Object.keys(english))
      expect(Object.keys(catalog)).toEqual(Object.keys(catalog).sort())
      const params = (text: string) =>
        [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort()
      for (const key of Object.values(builderSceneKeys)) {
        expect(catalog[sourceKeys.has(key) ? key : `${key}_other`]).toBeTruthy()
      }
      for (const [key, value] of Object.entries(catalog)) {
        const sourceKey = getTranslationSourceKey(sourceKeys, key, locale)
        assert(sourceKey, `Unknown difyBuilder key ${key} for ${locale}`)
        const sourceText = sourceCatalog[sourceKey]
        assert(sourceText, `Missing English difyBuilder key ${sourceKey}`)
        expect(params(value)).toEqual(params(sourceText))
      }
      for (const base of pluralBases) {
        for (const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories) {
          expect(catalog[`${base}_${category}`]).toBeTruthy()
        }
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

  it.each(
    (
      [
        {
          id: 'build.graphApplied',
          expected: [
            'Workflow draft created with 0 changes (configuration).',
            'Workflow draft created with 1 change (configuration).',
            'Workflow draft created with 2 changes (configuration).',
          ],
        },
        {
          id: 'edit.applied',
          expected: [
            'Applied 0 changes to the workflow draft (configuration).',
            'Applied 1 change to the workflow draft (configuration).',
            'Applied 2 changes to the workflow draft (configuration).',
          ],
        },
        {
          id: 'repair.applied',
          expected: [
            'Applied 0 changes (configuration).',
            'Applied 1 change (configuration).',
            'Applied 2 changes (configuration).',
          ],
        },
        {
          id: 'repair.changesApplied',
          expected: [
            'Applied 0 changes (configuration).',
            'Applied 1 change (configuration).',
            'Applied 2 changes (configuration).',
          ],
        },
      ] as const
    ).flatMap(({ id, expected }) => expected.map((text, count) => ({ id, count, expected: text }))),
  )('renders $id with count $count in English', ({ id, count, expected }) => {
    const t = instance.getFixedT('en-US', ['difyBuilder'])
    expect(
      resolveBuilderText({ type: 'copy', id, params: { count, scope: 'configuration' } }, t),
    ).toBe(expected)
  })

  it.each([
    ['ru-RU', 1, 'Применено 1 изменение (configuration).'],
    ['ru-RU', 2, 'Применено 2 изменения (configuration).'],
    ['ru-RU', 5, 'Применено 5 изменений (configuration).'],
    ['ar-TN', 0, 'تم تطبيق 0 تغيير (configuration).'],
    ['ar-TN', 2, 'تم تطبيق 2 من التغييرات (configuration).'],
    ['ar-TN', 3, 'تم تطبيق 3 تغييرات (configuration).'],
    ['zh-Hans', 2, '已应用 2 项更改（configuration）。'],
  ])('uses the %s plural form for %i applied changes', (locale, count, expected) => {
    const t = instance.getFixedT(locale, ['difyBuilder'])
    expect(
      resolveBuilderText(
        { type: 'copy', id: 'repair.changesApplied', params: { count, scope: 'configuration' } },
        t,
      ),
    ).toBe(expected)
  })
})
