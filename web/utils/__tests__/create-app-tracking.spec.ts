import Cookies from 'js-cookie'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as amplitude from '@/app/components/base/amplitude/utils'
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
    it('should keep the raw utm_source and report slug under its own field', () => {
      const attribution = extractExternalCreateAppAttribution({
        searchParams: new URLSearchParams('utm_source=x&slug=how-to-build-rag-agent'),
      })

      expect(attribution).toEqual({
        utmSource: 'x',
        slug: 'how-to-build-rag-agent',
      })
    })

    it('should accept any non-empty utm_source and keep raw values', () => {
      expect(
        extractExternalCreateAppAttribution({
          searchParams: new URLSearchParams('utm_source=newsletter'),
        }),
      ).toEqual({ utmSource: 'newsletter' })

      expect(
        extractExternalCreateAppAttribution({
          utmInfo: { utm_source: 'dify_blog', slug: 'launch-week' },
        }),
      ).toEqual({
        utmSource: 'dify_blog',
        slug: 'launch-week',
      })

      expect(
        extractExternalCreateAppAttribution({
          searchParams: new URLSearchParams('utm_source=random&slug=x'),
        }),
      ).toEqual({
        utmSource: 'random',
        slug: 'x',
      })
    })
  })

  describe('rememberCreateAppExternalAttribution', () => {
    it('should remember unknown utm_source values from the utm cookie', () => {
      vi.spyOn(Cookies, 'get').mockImplementation(((key?: string) => {
        return key
          ? JSON.stringify({
              utm_source: 'community',
              slug: 'partner-launch',
            })
          : {}
      }) as typeof Cookies.get)

      expect(rememberCreateAppExternalAttribution()).toEqual({
        utmSource: 'community',
        slug: 'partner-launch',
      })
      expect(window.sessionStorage.getItem('create_app_external_attribution')).toBe(
        JSON.stringify({
          utmSource: 'community',
          slug: 'partner-launch',
        }),
      )
    })

    it('should ignore malformed utm cookies', () => {
      vi.spyOn(Cookies, 'get').mockImplementation(((key?: string) => {
        return key ? 'not-json' : {}
      }) as typeof Cookies.get)

      expect(rememberCreateAppExternalAttribution()).toBeNull()
      expect(window.sessionStorage.getItem('create_app_external_attribution')).toBeNull()
    })
  })

  describe('buildCreateAppEventPayload', () => {
    it('should build payloads with source, normalized app mode, and timestamp', () => {
      expect(
        buildCreateAppEventPayload(
          {
            source: 'studio_blank',
            appMode: AppModeEnum.ADVANCED_CHAT,
          },
          null,
          new Date(2026, 3, 13, 14, 5, 9),
        ),
      ).toEqual({
        source: 'studio_blank',
        app_mode: 'chatflow',
        time: '04-13-14:05:09',
      })
    })

    it('should map agent mode into the canonical app mode bucket', () => {
      expect(
        buildCreateAppEventPayload(
          {
            source: 'studio_blank',
            appMode: AppModeEnum.AGENT_CHAT,
          },
          null,
          new Date(2026, 3, 13, 9, 8, 7),
        ),
      ).toEqual({
        source: 'studio_blank',
        app_mode: 'agent',
        time: '04-13-09:08:07',
      })
    })

    it('should map the current backend agent mode into the canonical app mode bucket', () => {
      expect(
        buildCreateAppEventPayload(
          {
            source: 'explore_template_list',
            appMode: 'agent',
          },
          null,
          new Date(2026, 3, 13, 9, 8, 8),
        ),
      ).toEqual({
        source: 'explore_template_list',
        app_mode: 'agent',
        time: '04-13-09:08:08',
      })
    })

    it('should fold legacy non-agent modes into chatflow', () => {
      expect(
        buildCreateAppEventPayload(
          {
            source: 'studio_blank',
            appMode: AppModeEnum.CHAT,
          },
          null,
          new Date(2026, 3, 13, 8, 0, 1),
        ),
      ).toEqual({
        source: 'studio_blank',
        app_mode: 'chatflow',
        time: '04-13-08:00:01',
      })

      expect(
        buildCreateAppEventPayload(
          {
            source: 'studio_blank',
            appMode: AppModeEnum.COMPLETION,
          },
          null,
          new Date(2026, 3, 13, 8, 0, 2),
        ),
      ).toEqual({
        source: 'studio_blank',
        app_mode: 'chatflow',
        time: '04-13-08:00:02',
      })
    })

    it('should map workflow mode into the workflow bucket', () => {
      expect(
        buildCreateAppEventPayload(
          {
            source: 'studio_blank',
            appMode: AppModeEnum.WORKFLOW,
          },
          null,
          new Date(2026, 3, 13, 7, 6, 5),
        ),
      ).toEqual({
        source: 'studio_blank',
        app_mode: 'workflow',
        time: '04-13-07:06:05',
      })
    })

    it('should include template_id for template sources', () => {
      expect(
        buildCreateAppEventPayload(
          {
            source: 'studio_template_list',
            appMode: AppModeEnum.CHAT,
            templateId: 'template-1',
          },
          null,
          new Date(2026, 3, 13, 8, 0, 1),
        ),
      ).toEqual({
        source: 'studio_template_list',
        app_mode: 'chatflow',
        time: '04-13-08:00:01',
        template_id: 'template-1',
      })
    })

    it('should prefer external attribution when present', () => {
      expect(
        buildCreateAppEventPayload(
          {
            source: 'studio_template_list',
            appMode: AppModeEnum.WORKFLOW,
            templateId: 'template-1',
          },
          {
            utmSource: 'linkedin',
            slug: 'agent-launch',
          },
          new Date(2026, 3, 13, 7, 6, 5),
        ),
      ).toEqual({
        source: 'external',
        app_mode: 'workflow',
        time: '04-13-07:06:05',
        template_id: 'template-1',
        utm_source: 'linkedin',
        slug: 'agent-launch',
      })
    })

    it('should not build external payloads without attribution', () => {
      expect(
        buildCreateAppEventPayload(
          {
            source: 'external',
            appMode: AppModeEnum.WORKFLOW,
          },
          null,
          new Date(2026, 3, 13, 7, 6, 5),
        ),
      ).toBeNull()
    })
  })

  describe('trackCreateApp', () => {
    it('should flush the create_app event immediately when tracking returns an SDK handle', async () => {
      vi.spyOn(amplitude, 'trackEvent').mockReturnValue({
        promise: Promise.resolve({}),
      } as ReturnType<typeof amplitude.trackEvent>)
      const flushEventsSpy = vi.spyOn(amplitude, 'flushEvents').mockReturnValue({
        promise: Promise.resolve(),
      } as ReturnType<typeof amplitude.flushEvents>)

      await expect(
        trackCreateApp({ source: 'studio_blank', appMode: AppModeEnum.ADVANCED_CHAT }),
      ).resolves.toBeUndefined()

      expect(amplitude.trackEvent).toHaveBeenCalledWith('create_app', {
        source: 'studio_blank',
        app_mode: 'chatflow',
        time: expect.stringMatching(/^\d{2}-\d{2}-\d{2}:\d{2}:\d{2}$/),
      })
      expect(flushEventsSpy).toHaveBeenCalledTimes(1)
    })

    it('should track remembered external attribution once before falling back to internal source', () => {
      rememberCreateAppExternalAttribution({
        searchParams: new URLSearchParams('utm_source=newsletter&slug=how-to-build-rag-agent'),
      })

      trackCreateApp({
        source: 'studio_template_list',
        appMode: AppModeEnum.WORKFLOW,
        templateId: 'template-1',
      })

      expect(amplitude.trackEvent).toHaveBeenNthCalledWith(1, 'create_app', {
        source: 'external',
        app_mode: 'workflow',
        time: expect.stringMatching(/^\d{2}-\d{2}-\d{2}:\d{2}:\d{2}$/),
        template_id: 'template-1',
        utm_source: 'newsletter',
        slug: 'how-to-build-rag-agent',
      })

      trackCreateApp({
        source: 'studio_template_list',
        appMode: AppModeEnum.WORKFLOW,
        templateId: 'template-1',
      })

      expect(amplitude.trackEvent).toHaveBeenNthCalledWith(2, 'create_app', {
        source: 'studio_template_list',
        app_mode: 'workflow',
        time: expect.stringMatching(/^\d{2}-\d{2}-\d{2}:\d{2}:\d{2}$/),
        template_id: 'template-1',
      })
    })

    it('should keep using remembered external attribution after navigating away from the original url', () => {
      window.history.replaceState({}, '', '/apps?utm_source=linkedin&slug=agent-launch')

      rememberCreateAppExternalAttribution({
        searchParams: new URLSearchParams(window.location.search),
      })

      window.history.replaceState({}, '', '/explore')

      trackCreateApp({
        source: 'explore_template_preview',
        appMode: AppModeEnum.CHAT,
        templateId: 'template-2',
      })

      expect(amplitude.trackEvent).toHaveBeenCalledWith('create_app', {
        source: 'external',
        app_mode: 'chatflow',
        time: expect.stringMatching(/^\d{2}-\d{2}-\d{2}:\d{2}:\d{2}$/),
        template_id: 'template-2',
        utm_source: 'linkedin',
        slug: 'agent-launch',
      })
    })

    it('should fall back to the provided source when window is unavailable', () => {
      const originalWindow = globalThis.window

      try {
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          value: undefined,
        })

        trackCreateApp({ source: 'studio_blank', appMode: AppModeEnum.AGENT_CHAT })

        expect(amplitude.trackEvent).toHaveBeenCalledWith('create_app', {
          source: 'studio_blank',
          app_mode: 'agent',
          time: expect.stringMatching(/^\d{2}-\d{2}-\d{2}:\d{2}:\d{2}$/),
        })
      } finally {
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          value: originalWindow,
        })
      }
    })

    it('should consume snake_case sessionStorage attribution and map legacy utm_campaign to slug', () => {
      window.sessionStorage.setItem(
        'create_app_external_attribution',
        JSON.stringify({
          utm_source: 'community',
          utm_campaign: 'launch-week',
        }),
      )

      trackCreateApp({ source: 'studio_blank', appMode: AppModeEnum.CHAT })

      expect(amplitude.trackEvent).toHaveBeenCalledWith('create_app', {
        source: 'external',
        app_mode: 'chatflow',
        time: expect.stringMatching(/^\d{2}-\d{2}-\d{2}:\d{2}:\d{2}$/),
        utm_source: 'community',
        slug: 'launch-week',
      })
      expect(window.sessionStorage.getItem('create_app_external_attribution')).toBeNull()
    })

    it('should not track external source without remembered attribution', () => {
      trackCreateApp({
        source: 'external',
        appMode: AppModeEnum.WORKFLOW,
        templateId: 'template-1',
      })

      expect(amplitude.trackEvent).not.toHaveBeenCalled()
    })
  })
})
