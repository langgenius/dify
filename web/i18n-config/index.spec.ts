import type { Locale } from '@/i18n-config/language'
import Cookies from 'js-cookie'
import { LOCALE_COOKIE_NAME } from '@/config'

// Mock dependencies
vi.mock('js-cookie', () => ({
  default: {
    set: vi.fn(),
  },
}))

vi.mock('@/i18n-config/client', () => ({
  changeLanguage: vi.fn().mockResolvedValue(undefined),
}))

// Mock location.reload
const mockReload = vi.fn()
Object.defineProperty(window, 'location', {
  value: { reload: mockReload },
  writable: true,
})

describe('i18n-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('setLocaleOnClient', () => {
    let setLocaleOnClient: typeof import('./index').setLocaleOnClient
    let changeLanguage: typeof import('@/i18n-config/client').changeLanguage

    beforeEach(async () => {
      const indexModule = await import('./index')
      const clientModule = await import('@/i18n-config/client')
      setLocaleOnClient = indexModule.setLocaleOnClient
      changeLanguage = clientModule.changeLanguage
    })

    /**
     * Tests that the locale cookie is set with correct options
     * including path: '/' to ensure it persists across all pages
     */
    it('should set locale cookie with path "/" for site-wide persistence', async () => {
      // Arrange
      const locale = 'es-ES'

      // Act
      await setLocaleOnClient(locale as Locale, false)

      // Assert
      expect(Cookies.set).toHaveBeenCalledWith(
        LOCALE_COOKIE_NAME,
        locale,
        { expires: 365, path: '/' },
      )
    })

    it('should call changeLanguage with the new locale', async () => {
      // Arrange
      const locale = 'zh-Hans'

      // Act
      await setLocaleOnClient(locale as Locale, false)

      // Assert
      expect(changeLanguage).toHaveBeenCalledWith(locale)
    })

    it('should reload page by default', async () => {
      // Arrange
      const locale = 'en-US'

      // Act
      await setLocaleOnClient(locale as Locale)

      // Assert
      expect(mockReload).toHaveBeenCalled()
    })

    it('should not reload page when reloadPage is false', async () => {
      // Arrange
      const locale = 'fr-FR'

      // Act
      await setLocaleOnClient(locale as Locale, false)

      // Assert
      expect(mockReload).not.toHaveBeenCalled()
    })
  })

  describe('renderI18nObject', () => {
    it('should return empty string for null/undefined input', async () => {
      // Arrange
      const { renderI18nObject } = await import('./index')

      // Act & Assert
      expect(renderI18nObject(null as unknown as Record<string, string>, 'en-US')).toBe('')
      expect(renderI18nObject(undefined as unknown as Record<string, string>, 'en-US')).toBe('')
    })

    it('should return value for matching language', async () => {
      // Arrange
      const { renderI18nObject } = await import('./index')
      const obj = { 'en-US': 'Hello', 'zh-Hans': '你好' }

      // Act & Assert
      expect(renderI18nObject(obj, 'en-US')).toBe('Hello')
      expect(renderI18nObject(obj, 'zh-Hans')).toBe('你好')
    })

    it('should fallback to en_US when language not found', async () => {
      // Arrange
      const { renderI18nObject } = await import('./index')
      const obj = { 'en_US': 'Hello', 'zh-Hans': '你好' }

      // Act
      const result = renderI18nObject(obj, 'fr-FR')

      // Assert
      expect(result).toBe('Hello')
    })

    it('should return first value when language and en_US not found', async () => {
      // Arrange
      const { renderI18nObject } = await import('./index')
      const obj = { 'zh-Hans': '你好', 'ja-JP': 'こんにちは' }

      // Act
      const result = renderI18nObject(obj, 'fr-FR')

      // Assert
      expect(result).toBe('你好')
    })
  })
})
