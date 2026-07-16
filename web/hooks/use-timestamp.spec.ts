import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { createAccountProfileQueryWrapper } from '@/test/account-profile-query'
import useTimestamp from './use-timestamp'

const mockUseLocale = vi.hoisted(() => vi.fn(() => 'en-US'))

vi.mock('@/context/i18n', () => ({
  useLocale: mockUseLocale,
}))

const createEmptyQueryWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  function EmptyQueryWrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }

  return { queryClient, wrapper: EmptyQueryWrapper }
}

describe('useTimestamp', () => {
  beforeEach(() => {
    mockUseLocale.mockReturnValue('en-US')
  })

  describe('formatTime', () => {
    it('should format unix timestamp correctly', () => {
      const { result } = renderHook(() => useTimestamp(), {
        wrapper: createAccountProfileQueryWrapper(),
      })
      const timestamp = 1704132000

      expect(result.current.formatTime(timestamp, 'YYYY-MM-DD HH:mm:ss')).toBe(
        '2024-01-02 02:00:00',
      )
    })

    it('should format with different patterns', () => {
      const { result } = renderHook(() => useTimestamp(), {
        wrapper: createAccountProfileQueryWrapper(),
      })
      const timestamp = 1704132000

      expect(result.current.formatTime(timestamp, 'MM/DD/YYYY')).toBe('01/02/2024')

      expect(result.current.formatTime(timestamp, 'HH:mm')).toBe('02:00')
    })

    it('should format month names with the current interface locale', () => {
      mockUseLocale.mockReturnValue('zh-Hans')
      const { result } = renderHook(() => useTimestamp(), {
        wrapper: createAccountProfileQueryWrapper(),
      })
      const timestamp = 1704132000

      expect(result.current.formatTime(timestamp, 'MMM D')).toBe('1月 2')
    })
  })

  describe('formatDate', () => {
    it('should format date string correctly', () => {
      const { result } = renderHook(() => useTimestamp(), {
        wrapper: createAccountProfileQueryWrapper(),
      })
      const dateString = '2024-01-01T12:00:00Z'

      expect(result.current.formatDate(dateString, 'YYYY-MM-DD HH:mm:ss')).toBe(
        '2024-01-01 20:00:00',
      )
    })

    it('should format with different patterns', () => {
      const { result } = renderHook(() => useTimestamp(), {
        wrapper: createAccountProfileQueryWrapper(),
      })
      const dateString = '2024-01-01T12:00:00Z'

      expect(result.current.formatDate(dateString, 'MM/DD/YYYY')).toBe('01/01/2024')

      expect(result.current.formatDate(dateString, 'HH:mm')).toBe('20:00')
    })

    it('should format date string month names with the current interface locale', () => {
      mockUseLocale.mockReturnValue('zh-Hans')
      const { result } = renderHook(() => useTimestamp(), {
        wrapper: createAccountProfileQueryWrapper(),
      })
      const dateString = '2024-01-01T12:00:00Z'

      expect(result.current.formatDate(dateString, 'MMM D')).toBe('1月 1')
    })
  })

  describe('formatMonthDay', () => {
    it('should format month and day naturally for English', () => {
      const { result } = renderHook(() => useTimestamp(), {
        wrapper: createAccountProfileQueryWrapper(),
      })
      const timestamp = 1704132000

      expect(result.current.formatMonthDay(timestamp)).toBe('Jan 2')
    })

    it('should format month and day naturally for Chinese', () => {
      mockUseLocale.mockReturnValue('zh-Hans')
      const { result } = renderHook(() => useTimestamp(), {
        wrapper: createAccountProfileQueryWrapper(),
      })
      const timestamp = 1704132000

      expect(result.current.formatMonthDay(timestamp)).toBe('1月2日')
    })
  })

  it('should not request account profile when timezone is provided', () => {
    const { queryClient, wrapper } = createEmptyQueryWrapper()

    const { result } = renderHook(() => useTimestamp({ timezone: 'UTC' }), { wrapper })

    expect(result.current.formatTime(1704132000, 'YYYY-MM-DD HH:mm')).toBe('2024-01-01 18:00')
    expect(queryClient.isFetching({ queryKey: userProfileQueryOptions().queryKey })).toBe(0)
    expect(queryClient.getQueryState(userProfileQueryOptions().queryKey)?.fetchStatus).toBe('idle')
  })
})
