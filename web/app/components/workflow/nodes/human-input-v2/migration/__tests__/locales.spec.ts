import i18next from 'i18next'
import { describe, expect, it } from 'vitest'
import { loadI18nResource } from '@/i18n/load-resource'
import { supportedLocales } from '@/i18n/locale'
import enUS from '@/i18n/locales/en-US/workflow.json'
import zhHans from '@/i18n/locales/zh-Hans/workflow.json'

const MIGRATION_PREFIX = 'nodes.humanInputMigration.'
const HUMAN_INPUT_KEYS = Object.keys(enUS).filter(
  (key) =>
    [
      'blocks.human-input-v2',
      'blocksAbout.human-input-v2',
      'changeHistory.humanInputMigration',
    ].includes(key) ||
    ['nodes.humanInput.output.', MIGRATION_PREFIX, 'nodes.humanInputV2.'].some((prefix) =>
      key.startsWith(prefix),
    ),
)

describe('Human Input migration locales', () => {
  it.each(supportedLocales)('loads every Human Input workflow string in %s', async (locale) => {
    const [{ default: workflow }, { default: workflowHumanInput }] = await Promise.all([
      loadI18nResource(locale, 'workflow'),
      loadI18nResource(locale, 'workflowHumanInput'),
    ])
    const i18n = i18next.createInstance()
    await i18n.init({
      lng: locale,
      fallbackLng: false,
      keySeparator: false,
      resources: { [locale]: { workflow, workflowHumanInput } },
    })

    for (const key of HUMAN_INPUT_KEYS)
      expect(i18n.getResource(locale, 'workflow', key), key).toEqual(expect.stringMatching(/\S/))

    expect(
      i18n.getResource(locale, 'workflowHumanInput', 'nodes.humanInput.userActions.defaultTitle'),
    ).toEqual(expect.stringMatching(/\S/))
    expect(
      i18n.t(($) => $['nodes.humanInput.userActions.defaultTitle'], {
        ns: 'workflowHumanInput',
        index: 3,
      }),
    ).toContain('3')
  })

  it('defines every migration string in English and Simplified Chinese', () => {
    const englishKeys = Object.keys(enUS)
      .filter((key) => key.startsWith(MIGRATION_PREFIX))
      .sort()
    const simplifiedChineseKeys = Object.keys(zhHans)
      .filter((key) => key.startsWith(MIGRATION_PREFIX))
      .sort()

    expect(simplifiedChineseKeys).toEqual(englishKeys)
    expect(englishKeys.length).toBeGreaterThan(0)
    for (const key of englishKeys) {
      const english = enUS[key as keyof typeof enUS]
      const simplifiedChinese = zhHans[key as keyof typeof zhHans]
      expect(english).toBeTruthy()
      expect(simplifiedChinese).toBeTruthy()
      expect(simplifiedChinese).not.toBe(english)
    }
  })

  it('localizes the migration history label without an English fallback', () => {
    expect(enUS['changeHistory.humanInputMigration']).toBeTruthy()
    expect(zhHans['changeHistory.humanInputMigration']).toBeTruthy()
    expect(zhHans['changeHistory.humanInputMigration']).not.toBe(
      enUS['changeHistory.humanInputMigration'],
    )
  })

  it('defines the refreshed Studio migration copy', () => {
    expect(enUS['nodes.humanInputMigration.disabledBadge']).toBe('MIGRATION REQUIRED')
    expect(enUS['nodes.humanInputMigration.dialog.title']).toBe(
      'Migrate {{count}} Human Input nodes',
    )
    expect(enUS['nodes.humanInputMigration.dialog.description']).toBe(
      'Your recipients, form, and actions carry over.',
    )
    expect(enUS['nodes.humanInputMigration.dialog.review']).toBe(
      'Review the nodes and publish when ready.',
    )
    expect(enUS['nodes.humanInputMigration.dialog.draftNotice']).toBe(
      'Only this draft changes. Published versions keep running until you publish again.',
    )
    expect(enUS['nodes.humanInputMigration.preview.author']).toBe('By Dify Team')
  })
})
