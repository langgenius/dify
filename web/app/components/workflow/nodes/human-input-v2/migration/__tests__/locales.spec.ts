import { describe, expect, it } from 'vitest'
import enUS from '@/i18n/en-US/workflow.json'
import zhHans from '@/i18n/zh-Hans/workflow.json'

const MIGRATION_PREFIX = 'nodes.humanInputMigration.'

describe('Human Input migration locales', () => {
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
