import type { SelectorParam } from 'i18next'
import { createInstance } from 'i18next'
import { describe, expect, it } from 'vitest'
import { getInitOptions } from '../settings'

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
      const memberKey: SelectorParam<'app'> = $ => $['accessControlDialog.members']

      // Act
      const singular = instance.t(memberKey, { count: 1 })
      const plural = instance.t(memberKey, { count: 2 })

      // Assert
      expect(singular).toBe('1 member')
      expect(plural).toBe('2 members')
    })
  })
})
