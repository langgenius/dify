// @vitest-environment node

import type { SelectorParam } from 'i18next'
import { readFileSync } from 'node:fs'
import { createInstance } from 'i18next'
import { describe, expect, it } from 'vite-plus/test'
import { supportedLocales } from '../locale'
import deployments from '../locales/en-US/deployments.json'
import skill from '../locales/en-US/skill.json'
import { getInitOptions } from '../settings'

function readLocaleResources(locale: string) {
  const read = (namespace: string): Record<string, string> =>
    JSON.parse(
      readFileSync(new URL(`../locales/${locale}/${namespace}.json`, import.meta.url), 'utf8'),
    )
  return { skill: read('skill'), deployments: read('deployments') }
}
const skillSelectors: SelectorParam<'skill'>[] = [
  ($) => $['skillManagement.deleteDialog.referencedDescription'],
  ($) => $['skillManagement.referenceCount'],
  ($) => $['skillManagement.detail.referencedBy'],
  ($) => $['skillManagement.detail.publishReferencesDescription'],
  ($) => $['skillManagement.detail.fileCount'],
]
const deploymentSelectors: SelectorParam<'deployments'>[] = [
  ($) => $['studio.versionsBehind'],
  ($) => $['studio.precheck.nodeCount'],
]
const counts = [0, 1, 2, 3, 4, 5, 11, 20, 21, 22, 101, 1_000_000, 1.5]

describe('i18n selector configuration', () => {
  describe('Plural Keys', () => {
    it.each(supportedLocales)(
      'keeps every migrated plural in %s instead of falling back to English',
      async (locale) => {
        const localized = readLocaleResources(locale)
        const instance = createInstance()
        await instance.init({
          ...getInitOptions(['skill', 'deployments']),
          lng: locale,
          resources: {
            'en-US': { skill, deployments },
            [locale]: localized,
          },
        })
        const rules = new Intl.PluralRules(locale)
        expect([...new Set(counts.map((count) => rules.select(count)))].sort()).toEqual(
          rules.resolvedOptions().pluralCategories.sort(),
        )

        for (const count of counts) {
          for (const selector of skillSelectors) {
            const result = instance.t(selector, { ns: 'skill', count, returnDetails: true })
            expect(result.usedLng, `${locale}: ${result.usedKey}, count=${count}`).toBe(locale)
            expect(localized.skill[result.exactUsedKey]).toBeDefined()
            expect(result.res).not.toContain('{{count}}')
          }
          for (const selector of deploymentSelectors) {
            const result = instance.t(selector, { ns: 'deployments', count, returnDetails: true })
            expect(result.usedLng, `${locale}: ${result.usedKey}, count=${count}`).toBe(locale)
            expect(localized.deployments[result.exactUsedKey]).toBeDefined()
            expect(result.res).not.toContain('{{count}}')
          }
        }
      },
    )

    it.each([
      {
        locale: 'ru-RU',
        count: 2,
        references: 'Используется 2 агентами',
        behind: 'Отставание на 2 версии',
      },
      {
        locale: 'ru-RU',
        count: 5,
        references: 'Используется 5 агентами',
        behind: 'Отставание на 5 версий',
      },
      { locale: 'ar-TN', count: 2, references: 'يستخدمها وكيلان (2)', behind: 'متأخر بإصدارين (2)' },
      { locale: 'ar-TN', count: 3, references: 'يستخدمها 3 وكلاء', behind: 'متأخر بـ 3 إصدارات' },
      { locale: 'ar-TN', count: 11, references: 'يستخدمها 11 وكيلًا', behind: 'متأخر بـ 11 إصدارًا' },
    ])(
      'renders localized references and version gaps in $locale for count $count',
      async ({ locale, count, references, behind }) => {
        const localized = readLocaleResources(locale)
        const instance = createInstance()
        await instance.init({
          ...getInitOptions(['skill', 'deployments']),
          lng: locale,
          resources: {
            'en-US': { skill, deployments },
            [locale]: localized,
          },
        })
        expect(
          instance.t(($) => $['skillManagement.detail.referencedBy'], { ns: 'skill', count }),
        ).toBe(references)
        expect(instance.t(($) => $['studio.versionsBehind'], { ns: 'deployments', count })).toBe(
          behind,
        )
      },
    )

    it.each([
      { count: 0, references: 'Used by 0 agents', behind: '0 versions behind' },
      { count: 1, references: 'Used by 1 agent', behind: '1 version behind' },
      { count: 2, references: 'Used by 2 agents', behind: '2 versions behind' },
    ])(
      'resolves migrated Skill and deployment base keys for count $count',
      async ({ count, references, behind }) => {
        const instance = createInstance()
        await instance.init({
          ...getInitOptions(['skill', 'deployments']),
          lng: 'en-US',
          resources: { 'en-US': { skill, deployments } },
        })

        expect(
          instance.t(($) => $['skillManagement.detail.referencedBy'], { ns: 'skill', count }),
        ).toBe(references)
        expect(instance.t(($) => $['studio.versionsBehind'], { ns: 'deployments', count })).toBe(
          behind,
        )
      },
    )

    it('should select plural variants from an unsuffixed base key', async () => {
      // Arrange
      const instance = createInstance()
      await instance.init({
        ...getInitOptions(),
        lng: 'en-US',
        resources: {
          'en-US': {
            app: {
              'accessControlDialog.members_one': '{{count}} member',
              'accessControlDialog.members_other': '{{count}} members',
            },
          },
        },
      })
      const memberKey: SelectorParam<'app'> = ($) => $['accessControlDialog.members']

      // Act
      const singular = instance.t(memberKey, { count: 1 })
      const plural = instance.t(memberKey, { count: 2 })

      // Assert
      expect(singular).toBe('1 member')
      expect(plural).toBe('2 members')
    })

    it('should pluralize Skill upload failure copy in the skill namespace', async () => {
      const instance = createInstance()
      await instance.init({
        ...getInitOptions(),
        lng: 'en-US',
        resources: { 'en-US': { skill } },
      })
      const uploadFailureKey: SelectorParam<'skill'> = ($) =>
        $['skillManagement.detail.uploadFilesFailedStatus']

      expect(instance.t(uploadFailureKey, { count: 1, ns: 'skill' })).toBe('1 file upload failed.')
      expect(instance.t(uploadFailureKey, { count: 2, ns: 'skill' })).toBe('2 file uploads failed.')
    })
  })
})
