import type { TFunction } from 'i18next'
import { withSelectorKey } from '@/test/i18n-mock'
import { AppModeEnum } from '@/types/app'
import { basePath } from '@/utils/var'
import { getDisabledFunctionTooltip, getPublisherAppMode, getPublisherAppUrl } from '../utils'

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
      expect(
        getPublisherAppUrl({
          appBaseUrl: 'https://example.com',
          accessToken: 'token-1',
          mode: AppModeEnum.CHAT,
        }),
      ).toBe(`https://example.com${basePath}/chat/token-1`)
    })
  })

  describe('getDisabledFunctionTooltip', () => {
    const t = withSelectorKey((key: string) => key, 'app') as unknown as TFunction

    it('should prioritize the unpublished hint', () => {
      expect(
        getDisabledFunctionTooltip({
          t,
          publishedAt: undefined,
          missingStartNode: false,
          noAccessPermission: false,
        }),
      ).toBe('notPublishedYet')
    })

    it('should return the access error when the app is published but blocked', () => {
      expect(
        getDisabledFunctionTooltip({
          t,
          publishedAt: Date.now(),
          missingStartNode: false,
          noAccessPermission: true,
        }),
      ).toBe('noAccessPermission')
    })
  })
})
