import type { DocPathMap } from './i18n'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import { useTranslation } from '#i18n'
import { renderHook } from '@testing-library/react'
import { getDocLanguage } from '@/i18n-config/language'
import { defaultDocBaseUrl, useDocLink } from './i18n'

// Mock dependencies
vi.mock('#i18n', () => ({
  useTranslation: vi.fn(() => ({
    i18n: { language: 'en-US' },
  })),
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
      expect(url).toBe(`${defaultDocBaseUrl}/en`)
    })

    it('should use custom base URL when provided', () => {
      const customBaseUrl = 'https://custom.docs.com'
      const { result } = renderHook(() => useDocLink(customBaseUrl))
      const url = result.current()
      expect(url).toBe(`${customBaseUrl}/en`)
    })

    it('should remove trailing slash from base URL', () => {
      const baseUrlWithSlash = 'https://docs.dify.ai/'
      const { result } = renderHook(() => useDocLink(baseUrlWithSlash))
      const url = result.current('/use-dify/getting-started/introduction')
      expect(url).toBe('https://docs.dify.ai/en/use-dify/getting-started/introduction')
    })

    it('should handle base URL without trailing slash', () => {
      const baseUrlWithoutSlash = 'https://docs.dify.ai'
      const { result } = renderHook(() => useDocLink(baseUrlWithoutSlash))
      const url = result.current('/use-dify/getting-started/introduction')
      expect(url).toBe('https://docs.dify.ai/en/use-dify/getting-started/introduction')
    })
  })

  describe('Path handling', () => {
    it('should handle path parameter', () => {
      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/getting-started/introduction')
      expect(url).toBe(`${defaultDocBaseUrl}/en/use-dify/getting-started/introduction`)
    })

    it('should handle empty path', () => {
      const { result } = renderHook(() => useDocLink())
      const url = result.current()
      expect(url).toBe(`${defaultDocBaseUrl}/en`)
    })

    it('should handle undefined path', () => {
      const { result } = renderHook(() => useDocLink())
      const url = result.current(undefined)
      expect(url).toBe(`${defaultDocBaseUrl}/en`)
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
        'en-US': '/use-dify/getting-started/quick-start',
      }

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/getting-started/quick-start' as DocPathWithoutLang, pathMap)
      expect(url).toBe(`${defaultDocBaseUrl}/zh/use-dify/getting-started/introduction`)
    })

    it('should use default path when locale not in pathMap', () => {
      vi.mocked(useTranslation).mockReturnValue({
        i18n: { language: 'ja-JP' },
      } as ReturnType<typeof useTranslation>)
      vi.mocked(getDocLanguage).mockReturnValue('ja')

      const pathMap: DocPathMap = {
        'zh-Hans': '/use-dify/getting-started/introduction',
        'en-US': '/use-dify/getting-started/quick-start',
      }

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/getting-started/quick-start' as DocPathWithoutLang, pathMap)
      expect(url).toBe(`${defaultDocBaseUrl}/ja/use-dify/getting-started/quick-start`)
    })

    it('should handle undefined pathMap', () => {
      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/getting-started/introduction', undefined)
      expect(url).toBe(`${defaultDocBaseUrl}/en/use-dify/getting-started/introduction`)
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
      const url = result.current('/api-reference/application/get-application-basic-information')
      expect(url).toBe(`${defaultDocBaseUrl}/api-reference/アプリケーション情報/アプリケーションの基本情報を取得`)
    })

    it('should not translate API reference path for English locale', () => {
      vi.mocked(useTranslation).mockReturnValue({
        i18n: { language: 'en-US' },
      } as ReturnType<typeof useTranslation>)
      vi.mocked(getDocLanguage).mockReturnValue('en')

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/api-reference/annotations/create-annotation')
      expect(url).toBe(`${defaultDocBaseUrl}/en/api-reference/annotations/create-annotation`)
    })

    it('should keep original path when no translation exists for non-English locale', () => {
      vi.mocked(useTranslation).mockReturnValue({
        i18n: { language: 'ja-JP' },
      } as ReturnType<typeof useTranslation>)
      vi.mocked(getDocLanguage).mockReturnValue('ja')

      const { result } = renderHook(() => useDocLink())
      // This path has no Japanese translation
      const url = result.current('/api-reference/annotations/create-annotation')
      expect(url).toBe(`${defaultDocBaseUrl}/ja/api-reference/annotations/create-annotation`)
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
      expect(url).toBe(`${defaultDocBaseUrl}/zh/use-dify/getting-started/introduction`)
    })
  })

  describe('Edge Cases', () => {
    it('should handle path with anchor', () => {
      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/getting-started/introduction#overview' as DocPathWithoutLang)
      expect(url).toBe(`${defaultDocBaseUrl}/en/use-dify/getting-started/introduction#overview`)
    })

    it('should handle multiple calls with same hook instance', () => {
      const { result } = renderHook(() => useDocLink())
      const url1 = result.current('/use-dify/getting-started/introduction')
      const url2 = result.current('/use-dify/getting-started/quick-start')
      expect(url1).toBe(`${defaultDocBaseUrl}/en/use-dify/getting-started/introduction`)
      expect(url2).toBe(`${defaultDocBaseUrl}/en/use-dify/getting-started/quick-start`)
    })
  })
})
