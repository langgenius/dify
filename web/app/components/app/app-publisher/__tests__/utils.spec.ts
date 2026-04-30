import type { TFunction } from 'i18next'
import { AccessMode } from '@/models/access-control'
import { AppModeEnum } from '@/types/app'
import { basePath } from '@/utils/var'
import {
  getDisabledFunctionTooltip,
  getPublisherAppMode,
  getPublisherAppUrl,
  isPublisherAccessConfigured,
} from '../utils'

describe('app-publisher utils', () => {
  describe('getPublisherAppMode', () => {
    it('should normalize chat-like apps to chat mode', () => {
      expect(getPublisherAppMode(AppModeEnum.AGENT_CHAT)).toBe(AppModeEnum.CHAT)
    })

    it('should keep completion mode unchanged', () => {
      expect(getPublisherAppMode(AppModeEnum.COMPLETION)).toBe(AppModeEnum.COMPLETION)
    })
  })

  describe('getPublisherAppUrl', () => {
    it('should build the published app url from site info', () => {
      expect(getPublisherAppUrl({
        appBaseUrl: 'https://example.com',
        accessToken: 'token-1',
        mode: AppModeEnum.CHAT,
      })).toBe(`https://example.com${basePath}/chat/token-1`)
    })
  })

  describe('isPublisherAccessConfigured', () => {
    it('should require members or groups for specific access mode', () => {
      expect(isPublisherAccessConfigured(
        { access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS },
        { groups: [], members: [] },
      )).toBe(false)
    })

    it('should treat public access as configured', () => {
      expect(isPublisherAccessConfigured(
        { access_mode: AccessMode.PUBLIC },
        { groups: [], members: [] },
      )).toBe(true)
    })
  })

  describe('getDisabledFunctionTooltip', () => {
    const t = ((key: string) => key) as unknown as TFunction

    it('should prioritize the unpublished hint', () => {
      expect(getDisabledFunctionTooltip({
        t,
        publishedAt: undefined,
        missingStartNode: false,
        noAccessPermission: false,
      })).toBe('notPublishedYet')
    })

    it('should return the access error when the app is published but blocked', () => {
      expect(getDisabledFunctionTooltip({
        t,
        publishedAt: Date.now(),
        missingStartNode: false,
        noAccessPermission: true,
      })).toBe('noAccessPermission')
    })
  })
})
