import Cookies from 'js-cookie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import * as amplitude from '@/app/components/base/amplitude/utils'
import { AgentScope } from '@/features/agent-v2/analytics'
import {
  buildCreateAppEventPayload,
  extractExternalCreateAppAttribution,
  rememberCreateAppExternalAttribution,
  trackCreateApp,
} from '../create-app-tracking'

describe('create-app-tracking', () => {
  const originalUrl = window.location.href

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(amplitude, 'trackEvent').mockImplementation(() => {})
    window.sessionStorage.clear()
    Cookies.remove('utm_info')
    window.history.replaceState({}, '', '/apps')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.sessionStorage.clear()
    Cookies.remove('utm_info')
    window.history.replaceState({}, '', originalUrl)
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
      Cookies.set('utm_info', JSON.stringify({ utm_source: 'community', slug: 'partner-launch' }))

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
      Cookies.set('utm_info', 'not-json')

      expect(rememberCreateAppExternalAttribution()).toBeNull()
      expect(window.sessionStorage.getItem('create_app_external_attribution')).toBeNull()
    })
  })

  describe('buildCreateAppEventPayload', () => {
    it.each([
      ['advanced-chat', 'chatflow'],
      ['chat', 'chatflow'],
      ['completion', 'chatflow'],
      ['agent-chat', 'agent'],
      ['agent', 'agent'],
      ['workflow', 'workflow'],
    ])('maps %s to %s while preserving source and local timestamp', (appMode, expectedMode) => {
      expect(
        buildCreateAppEventPayload(
          { source: 'explore_template_list', appMode },
          null,
          new Date(2026, 3, 13, 9, 8, 7),
        ),
      ).toEqual({ source: 'explore_template_list', app_mode: expectedMode, time: '04-13-09:08:07' })
    })

    it('should preserve agent v2 mode as its own app mode', () => {
      expect(
        buildCreateAppEventPayload(
          {
            source: 'studio_blank',
            appMode: 'agent-v2',
            agentScope: AgentScope.Global,
          },
          null,
          new Date(2026, 3, 13, 9, 8, 9),
        ),
      ).toEqual({
        source: 'studio_blank',
        app_mode: 'agent-v2',
        agent_scope: 'global',
        time: '04-13-09:08:09',
      })
    })

    it('should include template_id for template sources', () => {
      expect(
        buildCreateAppEventPayload(
          {
            source: 'studio_template_list',
            appMode: 'chat' as const,
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
            appMode: 'workflow' as const,
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
            appMode: 'workflow' as const,
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
        trackCreateApp({ source: 'studio_blank', appMode: 'advanced-chat' as const }),
      ).resolves.toBeUndefined()

      expect(amplitude.trackEvent).toHaveBeenCalledWith('create_app', {
        source: 'studio_blank',
        app_mode: 'chatflow',
        time: expect.stringMatching(/^\d{2}-\d{2}-\d{2}:\d{2}:\d{2}$/),
      })
      expect(flushEventsSpy).toHaveBeenCalledTimes(1)
    })

    it('should track remembered external attribution once before falling back to internal source', async () => {
      rememberCreateAppExternalAttribution({
        searchParams: new URLSearchParams('utm_source=newsletter&slug=how-to-build-rag-agent'),
      })

      await trackCreateApp({
        source: 'studio_template_list',
        appMode: 'workflow' as const,
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

      await trackCreateApp({
        source: 'studio_template_list',
        appMode: 'workflow' as const,
        templateId: 'template-1',
      })

      expect(amplitude.trackEvent).toHaveBeenNthCalledWith(2, 'create_app', {
        source: 'studio_template_list',
        app_mode: 'workflow',
        time: expect.stringMatching(/^\d{2}-\d{2}-\d{2}:\d{2}:\d{2}$/),
        template_id: 'template-1',
      })
    })

    it('should attribute an agent roster creation to the external agents landing URL', async () => {
      window.history.replaceState(
        {},
        '',
        '/agents?utm_source=dify_blog&slug=buildaisupportassistantwithdify',
      )
      rememberCreateAppExternalAttribution({
        searchParams: new URLSearchParams(window.location.search),
      })

      await trackCreateApp({
        source: 'studio_blank',
        appMode: 'agent-v2',
      })

      expect(amplitude.trackEvent).toHaveBeenCalledWith('create_app', {
        source: 'external',
        app_mode: 'agent-v2',
        time: expect.stringMatching(/^\d{2}-\d{2}-\d{2}:\d{2}:\d{2}$/),
        utm_source: 'dify_blog',
        slug: 'buildaisupportassistantwithdify',
      })
    })

    it('should keep using remembered external attribution after navigating away from the original url', async () => {
      window.history.replaceState({}, '', '/apps?utm_source=linkedin&slug=agent-launch')

      rememberCreateAppExternalAttribution({
        searchParams: new URLSearchParams(window.location.search),
      })

      window.history.replaceState({}, '', '/explore')

      await trackCreateApp({
        source: 'explore_template_preview',
        appMode: 'chat' as const,
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

    it('should fall back to the provided source when window is unavailable', async () => {
      const originalWindow = globalThis.window

      try {
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          value: undefined,
        })

        await trackCreateApp({ source: 'studio_blank', appMode: 'agent-chat' as const })

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

    it('should consume snake_case sessionStorage attribution and map legacy utm_campaign to slug', async () => {
      window.sessionStorage.setItem(
        'create_app_external_attribution',
        JSON.stringify({
          utm_source: 'community',
          utm_campaign: 'launch-week',
        }),
      )

      await trackCreateApp({ source: 'studio_blank', appMode: 'chat' as const })

      expect(amplitude.trackEvent).toHaveBeenCalledWith('create_app', {
        source: 'external',
        app_mode: 'chatflow',
        time: expect.stringMatching(/^\d{2}-\d{2}-\d{2}:\d{2}:\d{2}$/),
        utm_source: 'community',
        slug: 'launch-week',
      })
      expect(window.sessionStorage.getItem('create_app_external_attribution')).toBeNull()
    })

    it('should not track external source without remembered attribution', async () => {
      await trackCreateApp({
        source: 'external',
        appMode: 'workflow' as const,
        templateId: 'template-1',
      })

      expect(amplitude.trackEvent).not.toHaveBeenCalled()
    })
  })
})
