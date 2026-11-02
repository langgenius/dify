import { renderHook } from '@testing-library/react'
import { useLocale } from '#i18n'
import { useFormatTimeFromNow } from './use-format-time-from-now'

vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: vi.fn(() => 'en-US'),
}))

const hour = 60 * 60 * 1000

describe('useFormatTimeFromNow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
    vi.mocked(useLocale).mockReturnValue('en-US')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['en-US', 'an hour ago'],
    ['zh-Hans', '1 小时前'],
    ['es-ES', 'hace una hora'],
    ['fr-FR', 'il y a une heure'],
    ['ja-JP', '1時間前'],
    ['pt-BR', 'há uma hora'],
    ['ar-TN', 'an hour ago'],
  ] as const)(
    'maps %s to the relative-time locale, falling back to English',
    (locale, expected) => {
      vi.mocked(useLocale).mockReturnValue(locale)
      const { result } = renderHook(() => useFormatTimeFromNow())

      expect(result.current.formatTimeFromNow(Date.now() - hour)).toBe(expected)
    },
  )

  it('formats future timestamps without treating them as elapsed time', () => {
    const { result } = renderHook(() => useFormatTimeFromNow())

    expect(result.current.formatTimeFromNow(Date.now() + 2 * hour)).toBe('in 2 hours')
  })

  it('uses the new language when the locale changes', () => {
    const { result, rerender } = renderHook(() => useFormatTimeFromNow())
    const timestamp = Date.now() - hour
    expect(result.current.formatTimeFromNow(timestamp)).toBe('an hour ago')

    vi.mocked(useLocale).mockReturnValue('es-ES')
    rerender()

    expect(result.current.formatTimeFromNow(timestamp)).toBe('hace una hora')
  })
})
