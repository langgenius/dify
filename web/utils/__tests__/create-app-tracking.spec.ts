import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as amplitude from '@/app/components/base/amplitude'
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

  describe('buildCreateAppEventPayload', () => {
    it('should build template payloads with template id', () => {
      expect(buildCreateAppEventPayload({
        source: 'explore_template_preview',
        templateId: 'template-1',
      })).toEqual({
        source: 'explore_template_preview',
        template_id: 'template-1',
      })
    })

    it('should prefer external attribution when present', () => {
      expect(buildCreateAppEventPayload(
        {
          source: 'studio_template_list',
          templateId: 'template-2',
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

      trackCreateApp({ source: 'studio_blank' })

      expect(amplitude.trackEvent).toHaveBeenNthCalledWith(1, 'create_app', {
        source: 'external',
        utm_source: 'blog',
        utm_campaign: 'how-to-build-rag-agent',
      })

      trackCreateApp({ source: 'studio_blank' })

      expect(amplitude.trackEvent).toHaveBeenNthCalledWith(2, 'create_app', {
        source: 'studio_blank',
      })
    })
  })
})
