import type { SelectorParam } from 'i18next'
import { createInstance } from 'i18next'
import { describe, expect, it } from 'vitest'
import arTN from '../../i18n/ar-TN/common.json'
import enUS from '../../i18n/en-US/common.json'
import plPL from '../../i18n/pl-PL/common.json'
import roRO from '../../i18n/ro-RO/common.json'
import ruRU from '../../i18n/ru-RU/common.json'
import slSI from '../../i18n/sl-SI/common.json'
import ukUA from '../../i18n/uk-UA/common.json'
import { getInitOptions } from '../settings'

const invitationCountKeys: Array<{
  key: string
  selector: SelectorParam<'common'>
}> = [
  {
    key: 'members.recipientCount',
    selector: ($) => $['members.recipientCount'],
  },
  {
    key: 'members.seatsRemaining',
    selector: ($) => $['members.seatsRemaining'],
  },
  {
    key: 'members.sendInviteCount',
    selector: ($) => $['members.sendInviteCount'],
  },
]

const pluralLocaleCases = [
  { locale: 'ar-TN', resource: arTN, counts: [0, 1, 2, 3, 11, 100] },
  { locale: 'ru-RU', resource: ruRU, counts: [0, 1, 2, 5] },
  { locale: 'uk-UA', resource: ukUA, counts: [0, 1, 2, 5] },
  { locale: 'pl-PL', resource: plPL, counts: [0, 1, 2, 5] },
  { locale: 'ro-RO', resource: roRO, counts: [0, 1, 2, 20] },
  { locale: 'sl-SI', resource: slSI, counts: [0, 1, 2, 3, 5] },
] as const

describe('i18n selector configuration', () => {
  describe('Plural Keys', () => {
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

    it('should keep invitation counts localized for languages with multiple plural forms', async () => {
      for (const { locale, resource, counts } of pluralLocaleCases) {
        const instance = createInstance()
        await instance.init({
          ...getInitOptions(),
          lng: locale,
          resources: {
            [locale]: { common: resource },
            'en-US': { common: enUS },
          },
        })
        const pluralRules = new Intl.PluralRules(locale)
        const translations = resource as Record<string, string>

        for (const { key, selector } of invitationCountKeys) {
          for (const count of counts) {
            const suffix =
              count === 0 && `${key}_zero` in translations ? 'zero' : pluralRules.select(count)
            const expected = translations[`${key}_${suffix}`]?.replace('{{count}}', String(count))

            expect(expected).toBeDefined()
            expect(instance.t(selector, { count, ns: 'common' })).toBe(expected)
          }
        }
      }
    })
  })
})
