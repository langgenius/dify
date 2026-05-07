import Cookies from 'js-cookie'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as amplitude from '@/app/components/base/amplitude'
import { AppModeEnum } from '@/types/app'
import {
  buildCreateAppEventPayload,
  extractExternalCreateAppAttribution,
  rememberCreateAppExternalAttribution,
  trackCreateApp,
} from '../create-app-tracking'

describe('create-app-tracking', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(amplitude, 'trackEvent').mockImplementation(() => {})
    window.sessionStorage.clear()
    window.history.replaceState({}, '', '/apps')
  })

  describe('extractExternalCreateAppAttribution', () => {
    it('should map campaign links to external attribution', () => {
      const attribution = extractExternalCreateAppAttribution({
        searchParams: new URLSearchParams('utm_source=x&slug=how-to-build-rag-agent'),
      })

      expect(attribution).toEqual({
        utmSource: 'twitter/x',
        utmCampaign: 'how-to-build-rag-agent',
      })
    })

    it('should map newsletter and blog sources to blog', () => {
      expect(extractExternalCreateAppAttribution({
        searchParams: new URLSearchParams('utm_source=newsletter'),
      })).toEqual({ utmSource: 'blog' })

      expect(extractExternalCreateAppAttribution({
        utmInfo: { utm_source: 'dify_blog', slug: 'launch-week' },
      })).toEqual({
        utmSource: 'blog',
        utmCampaign: 'launch-week',
      })
    })
  })

  describe('rememberCreateAppExternalAttribution', () => {
    it('should ignore malformed utm cookies', () => {
      vi.spyOn(Cookies, 'get').mockImplementation(((key?: string) => {
        return key ? 'not-json' : {}
      }) as typeof Cookies.get)

      expect(rememberCreateAppExternalAttribution()).toBeNull()
      expect(window.sessionStorage.getItem('create_app_external_attribution')).toBeNull()
    })
  })

  describe('buildCreateAppEventPayload', () => {
    it('should build original payloads with normalized app mode and timestamp', () => {
      expect(buildCreateAppEventPayload({
        appMode: AppModeEnum.ADVANCED_CHAT,
      }, null, new Date(2026, 3, 13, 14, 5, 9))).toEqual({
        source: 'original',
        app_mode: 'chatflow',
        time: '04-13-14:05:09',
      })
    })

    it('should map agent mode into the canonical app mode bucket', () => {
      expect(buildCreateAppEventPayload({
        appMode: AppModeEnum.AGENT_CHAT,
      }, null, new Date(2026, 3, 13, 9, 8, 7))).toEqual({
        source: 'original',
        app_mode: 'agent',
        time: '04-13-09:08:07',
      })
    })

    it('should fold legacy non-agent modes into chatflow', () => {
      expect(buildCreateAppEventPayload({
        appMode: AppModeEnum.CHAT,
      }, null, new Date(2026, 3, 13, 8, 0, 1))).toEqual({
        source: 'original',
        app_mode: 'chatflow',
        time: '04-13-08:00:01',
      })

      expect(buildCreateAppEventPayload({
        appMode: AppModeEnum.COMPLETION,
      }, null, new Date(2026, 3, 13, 8, 0, 2))).toEqual({
        source: 'original',
        app_mode: 'chatflow',
        time: '04-13-08:00:02',
      })
    })

    it('should map workflow mode into the workflow bucket', () => {
      expect(buildCreateAppEventPayload({
        appMode: AppModeEnum.WORKFLOW,
      }, null, new Date(2026, 3, 13, 7, 6, 5))).toEqual({
        source: 'original',
        app_mode: 'workflow',
        time: '04-13-07:06:05',
      })
    })

    it('should prefer external attribution when present', () => {
      expect(buildCreateAppEventPayload(
        {
          appMode: AppModeEnum.WORKFLOW,
        },
        {
          utmSource: 'linkedin',
          utmCampaign: 'agent-launch',
        },
      )).toEqual({
        source: 'external',
        utm_source: 'linkedin',
        utm_campaign: 'agent-launch',
      })
    })
  })

  describe('trackCreateApp', () => {
    it('should track remembered external attribution once before falling back to internal source', () => {
      rememberCreateAppExternalAttribution({
        searchParams: new URLSearchParams('utm_source=newsletter&slug=how-to-build-rag-agent'),
      })

      trackCreateApp({ appMode: AppModeEnum.WORKFLOW })

      expect(amplitude.trackEvent).toHaveBeenNthCalledWith(1, 'create_app', {
        source: 'external',
        utm_source: 'blog',
        utm_campaign: 'how-to-build-rag-agent',
      })

      trackCreateApp({ appMode: AppModeEnum.WORKFLOW })

      expect(amplitude.trackEvent).toHaveBeenNthCalledWith(2, 'create_app', {
        source: 'original',
        app_mode: 'workflow',
        time: expect.stringMatching(/^\d{2}-\d{2}-\d{2}:\d{2}:\d{2}$/),
      })
    })

    it('should keep using remembered external attribution after navigating away from the original url', () => {
      window.history.replaceState({}, '', '/apps?utm_source=linkedin&slug=agent-launch')

      rememberCreateAppExternalAttribution({
        searchParams: new URLSearchParams(window.location.search),
      })

      window.history.replaceState({}, '', '/explore')

      trackCreateApp({ appMode: AppModeEnum.CHAT })

      expect(amplitude.trackEvent).toHaveBeenCalledWith('create_app', {
        source: 'external',
        utm_source: 'linkedin',
        utm_campaign: 'agent-launch',
      })
    })

    it('should fall back to the original payload when window is unavailable', () => {
      const originalWindow = globalThis.window

      try {
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          value: undefined,
        })

        trackCreateApp({ appMode: AppModeEnum.AGENT_CHAT })

        expect(amplitude.trackEvent).toHaveBeenCalledWith('create_app', {
          source: 'original',
          app_mode: 'agent',
          time: expect.stringMatching(/^\d{2}-\d{2}-\d{2}:\d{2}:\d{2}$/),
        })
      }
      finally {
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          value: originalWindow,
        })
      }
    })
  })
})
