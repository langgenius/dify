import type { DocPathMap } from './i18n'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import { renderHook } from '@testing-library/react'
import { useTranslation } from '#i18n'
import { getDocLanguage } from '@/i18n-config/language'
import { defaultDocBaseUrl, useDocLink } from './i18n'

const mockConfig = vi.hoisted(() => ({
  IS_CLOUD_EDITION: true,
}))

// Mock dependencies
vi.mock('#i18n', () => ({
  useTranslation: vi.fn(() => ({
    i18n: { language: 'en-US' },
  })),
}))

vi.mock('@/config', () => ({
  get IS_CLOUD_EDITION() {
    return mockConfig.IS_CLOUD_EDITION
  },
}))

vi.mock('@/i18n-config/language', () => ({
  getDocLanguage: vi.fn((locale: string) => {
    const map: Record<string, string> = {
      'zh-Hans': 'zh',
      'ja-JP': 'ja',
      'en-US': 'en',
    }
    return map[locale] || 'en'
  }),
  getLanguage: vi.fn(),
  getPricingPageLanguage: vi.fn(),
}))

describe('useDocLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfig.IS_CLOUD_EDITION = true
    vi.mocked(useTranslation).mockReturnValue({
      i18n: { language: 'en-US' },
    } as ReturnType<typeof useTranslation>)
    vi.mocked(getDocLanguage).mockReturnValue('en')
  })

  describe('Rendering', () => {
    it('should return a function', () => {
      const { result } = renderHook(() => useDocLink())
      expect(typeof result.current).toBe('function')
    })
  })

  describe('Base URL handling', () => {
    it('should use default base URL when no baseUrl provided', () => {
      const { result } = renderHook(() => useDocLink())
      const url = result.current()
      expect(url).toBe(`${defaultDocBaseUrl}/en/home`)
    })

    it('should use custom base URL when provided', () => {
      const customBaseUrl = 'https://custom.docs.com'
      const { result } = renderHook(() => useDocLink(customBaseUrl))
      const url = result.current()
      expect(url).toBe(`${customBaseUrl}/en/home`)
    })

    it('should remove trailing slash from base URL', () => {
      const baseUrlWithSlash = 'https://docs.dify.ai/'
      const { result } = renderHook(() => useDocLink(baseUrlWithSlash))
      const url = result.current('/use-dify/getting-started/introduction')
      expect(url).toBe('https://docs.dify.ai/en/cloud/use-dify/getting-started/introduction')
    })

    it('should handle base URL without trailing slash', () => {
      const baseUrlWithoutSlash = 'https://docs.dify.ai'
      const { result } = renderHook(() => useDocLink(baseUrlWithoutSlash))
      const url = result.current('/use-dify/getting-started/introduction')
      expect(url).toBe('https://docs.dify.ai/en/cloud/use-dify/getting-started/introduction')
    })
  })

  describe('Path handling', () => {
    it('should handle path parameter', () => {
      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/getting-started/introduction')
      expect(url).toBe(`${defaultDocBaseUrl}/en/cloud/use-dify/getting-started/introduction`)
    })

    it('should handle empty path', () => {
      const { result } = renderHook(() => useDocLink())
      const url = result.current()
      expect(url).toBe(`${defaultDocBaseUrl}/en/home`)
    })

    it('should handle undefined path', () => {
      const { result } = renderHook(() => useDocLink())
      const url = result.current(undefined)
      expect(url).toBe(`${defaultDocBaseUrl}/en/home`)
    })

    it('should keep common docs path without product prefix', () => {
      const { result } = renderHook(() => useDocLink())
      const url = result.current('/learn/key-concepts' as DocPathWithoutLang)
      expect(url).toBe(`${defaultDocBaseUrl}/en/learn/key-concepts`)
    })

    it('should keep explicit product docs path without adding another product prefix', () => {
      const { result } = renderHook(() => useDocLink())
      const url = result.current('/cloud/use-dify/build/mcp' as DocPathWithoutLang)
      expect(url).toBe(`${defaultDocBaseUrl}/en/cloud/use-dify/build/mcp`)
    })
  })

  describe('PathMap handling', () => {
    it('should use path from pathMap when locale matches', () => {
      vi.mocked(useTranslation).mockReturnValue({
        i18n: { language: 'zh-Hans' },
      } as ReturnType<typeof useTranslation>)
      vi.mocked(getDocLanguage).mockReturnValue('zh')

      const pathMap: DocPathMap = {
        'zh-Hans': '/use-dify/getting-started/introduction',
        'en-US': '/use-dify/build/mcp',
      }

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/build/mcp', pathMap)
      expect(url).toBe(`${defaultDocBaseUrl}/zh/cloud/use-dify/getting-started/introduction`)
    })

    it('should use default path when locale not in pathMap', () => {
      vi.mocked(useTranslation).mockReturnValue({
        i18n: { language: 'ja-JP' },
      } as ReturnType<typeof useTranslation>)
      vi.mocked(getDocLanguage).mockReturnValue('ja')

      const pathMap: DocPathMap = {
        'zh-Hans': '/use-dify/getting-started/introduction',
        'en-US': '/use-dify/build/mcp',
      }

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/build/mcp', pathMap)
      expect(url).toBe(`${defaultDocBaseUrl}/ja/cloud/use-dify/build/mcp`)
    })

    it('should handle undefined pathMap', () => {
      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/getting-started/introduction', undefined)
      expect(url).toBe(`${defaultDocBaseUrl}/en/cloud/use-dify/getting-started/introduction`)
    })
  })

  describe('Product prefix handling', () => {
    it('should add cloud product prefix for product docs available in both editions', () => {
      mockConfig.IS_CLOUD_EDITION = true

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/build/mcp')
      expect(url).toBe(`${defaultDocBaseUrl}/en/cloud/use-dify/build/mcp`)
    })

    it('should add self-host product prefix for product docs available in both editions outside cloud edition', () => {
      mockConfig.IS_CLOUD_EDITION = false

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/build/mcp')
      expect(url).toBe(`${defaultDocBaseUrl}/en/self-host/use-dify/build/mcp`)
    })

    it('should use the existing cloud docs path for cloud-only product docs outside cloud edition', () => {
      mockConfig.IS_CLOUD_EDITION = false

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/workspace/subscription-management#dify-for-education')
      expect(url).toBe(`${defaultDocBaseUrl}/en/cloud/use-dify/workspace/subscription-management#dify-for-education`)
    })

    it('should use the existing self-host docs path for self-host-only product docs in cloud edition', () => {
      mockConfig.IS_CLOUD_EDITION = true

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/deploy/overview')
      expect(url).toBe(`${defaultDocBaseUrl}/en/self-host/deploy/overview`)
    })

    it('should not add a product prefix for unknown productless paths', () => {
      mockConfig.IS_CLOUD_EDITION = false

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/unknown-page' as DocPathWithoutLang)
      expect(url).toBe(`${defaultDocBaseUrl}/en/use-dify/unknown-page`)
    })

    it('should open shared docs home when no path is provided outside cloud edition', () => {
      mockConfig.IS_CLOUD_EDITION = false

      const { result } = renderHook(() => useDocLink())
      const url = result.current()
      expect(url).toBe(`${defaultDocBaseUrl}/en/home`)
    })

    it('should keep self-host deploy paths without adding use-dify product prefix', () => {
      mockConfig.IS_CLOUD_EDITION = true

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/self-host/deploy/overview' as DocPathWithoutLang)
      expect(url).toBe(`${defaultDocBaseUrl}/en/self-host/deploy/overview`)
    })
  })

  describe('Language prefix handling', () => {
    it('should add /en prefix for English locale', () => {
      vi.mocked(useTranslation).mockReturnValue({
        i18n: { language: 'en-US' },
      } as ReturnType<typeof useTranslation>)
      vi.mocked(getDocLanguage).mockReturnValue('en')

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/getting-started/introduction')
      expect(url).toContain('/en/')
    })

    it('should add /zh prefix for Chinese locale', () => {
      vi.mocked(useTranslation).mockReturnValue({
        i18n: { language: 'zh-Hans' },
      } as ReturnType<typeof useTranslation>)
      vi.mocked(getDocLanguage).mockReturnValue('zh')

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/getting-started/introduction')
      expect(url).toContain('/zh/')
    })

    it('should add /ja prefix for Japanese locale', () => {
      vi.mocked(useTranslation).mockReturnValue({
        i18n: { language: 'ja-JP' },
      } as ReturnType<typeof useTranslation>)
      vi.mocked(getDocLanguage).mockReturnValue('ja')

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/getting-started/introduction')
      expect(url).toContain('/ja/')
    })
  })

  describe('API reference path translations', () => {
    it('should translate API reference path for Chinese locale', () => {
      vi.mocked(useTranslation).mockReturnValue({
        i18n: { language: 'zh-Hans' },
      } as ReturnType<typeof useTranslation>)
      vi.mocked(getDocLanguage).mockReturnValue('zh')

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/api-reference/annotations/create-annotation')
      expect(url).toBe(`${defaultDocBaseUrl}/api-reference/标注管理/创建标注`)
    })

    it('should translate API reference path for Japanese locale when translation exists', () => {
      vi.mocked(useTranslation).mockReturnValue({
        i18n: { language: 'ja-JP' },
      } as ReturnType<typeof useTranslation>)
      vi.mocked(getDocLanguage).mockReturnValue('ja')

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/api-reference/applications/get-app-info')
      expect(url).toBe(`${defaultDocBaseUrl}/api-reference/アプリケーション設定/アプリケーションの基本情報を取得`)
    })

    it('should not translate API reference path for English locale', () => {
      vi.mocked(useTranslation).mockReturnValue({
        i18n: { language: 'en-US' },
      } as ReturnType<typeof useTranslation>)
      vi.mocked(getDocLanguage).mockReturnValue('en')

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/api-reference/annotations/create-annotation')
      expect(url).toBe(`${defaultDocBaseUrl}/api-reference/annotations/create-annotation`)
    })

    it('should keep original path when no translation exists for non-English locale', () => {
      vi.mocked(useTranslation).mockReturnValue({
        i18n: { language: 'zh-Hans' },
      } as ReturnType<typeof useTranslation>)
      vi.mocked(getDocLanguage).mockReturnValue('zh')

      const { result } = renderHook(() => useDocLink())
      // This path has no Japanese translation
      const url = result.current('/api-reference/annotations/create-annotation')
      expect(url).toBe(`${defaultDocBaseUrl}/api-reference/标注管理/创建标注`)
    })

    it('should remove language prefix when translation is applied', () => {
      vi.mocked(useTranslation).mockReturnValue({
        i18n: { language: 'zh-Hans' },
      } as ReturnType<typeof useTranslation>)
      vi.mocked(getDocLanguage).mockReturnValue('zh')

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/api-reference/annotations/create-annotation')
      // Should NOT have /zh/ prefix when translated
      expect(url).not.toContain('/zh/')
      expect(url).toBe(`${defaultDocBaseUrl}/api-reference/标注管理/创建标注`)
    })

    it('should not translate non-API-reference paths', () => {
      vi.mocked(useTranslation).mockReturnValue({
        i18n: { language: 'zh-Hans' },
      } as ReturnType<typeof useTranslation>)
      vi.mocked(getDocLanguage).mockReturnValue('zh')

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/getting-started/introduction')
      expect(url).toBe(`${defaultDocBaseUrl}/zh/cloud/use-dify/getting-started/introduction`)
    })
  })

  describe('Edge Cases', () => {
    it('should handle path with anchor', () => {
      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/getting-started/introduction#overview' as DocPathWithoutLang)
      expect(url).toBe(`${defaultDocBaseUrl}/en/cloud/use-dify/getting-started/introduction#overview`)
    })

    it('should handle multiple calls with same hook instance', () => {
      const { result } = renderHook(() => useDocLink())
      const url1 = result.current('/use-dify/getting-started/introduction')
      const url2 = result.current('/use-dify/build/mcp')
      expect(url1).toBe(`${defaultDocBaseUrl}/en/cloud/use-dify/getting-started/introduction`)
      expect(url2).toBe(`${defaultDocBaseUrl}/en/cloud/use-dify/build/mcp`)
    })
  })
})
