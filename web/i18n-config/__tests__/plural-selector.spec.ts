import type { SelectorParam } from 'i18next'
import { createInstance } from 'i18next'
import { describe, expect, it } from 'vite-plus/test'
import agentV2 from '../../i18n/en-US/agent-v-2.json'
import skill from '../../i18n/en-US/skill.json'
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

    it('should pluralize Skill upload failure copy in the Agent V2 namespace', async () => {
      const instance = createInstance()
      await instance.init({
        ...getInitOptions(),
        lng: 'en-US',
        resources: { 'en-US': { agentV2 } },
      })
      const uploadFailureKey: SelectorParam<'agentV2'> = ($) =>
        $['skillManagement.detail.uploadFilesFailedStatus']

      expect(instance.t(uploadFailureKey, { count: 1, ns: 'agentV2' })).toBe(
        '1 file upload failed.',
      )
      expect(instance.t(uploadFailureKey, { count: 2, ns: 'agentV2' })).toBe(
        '2 file uploads failed.',
      )
    })
  })
})
