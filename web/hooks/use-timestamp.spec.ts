import { renderHook } from '@testing-library/react'
import useTimestamp from './use-timestamp'

jest.mock('@/context/app-context', () => ({
  useAppContext: jest.fn(() => ({
    userProfile: {
      id: '8b18e24b-1ac8-4262-aa5c-e9aa95c76846',
      name: 'test',
      avatar: null,
      avatar_url: null,
      email: 'test@dify.ai',
      is_password_set: false,
      interface_language: 'zh-Hans',
      interface_theme: 'light',
      timezone: 'Asia/Shanghai',
      last_login_at: 1744188761,
      last_login_ip: '127.0.0.1',
      created_at: 1728444483,
    },
  })),
}))

describe('useTimestamp', () => {
  describe('formatTime', () => {
    it('should format unix timestamp correctly', () => {
      const { result } = renderHook(() => useTimestamp())
      const timestamp = 1704132000

      expect(result.current.formatTime(timestamp, 'YYYY-MM-DD HH:mm:ss'))
        .toBe('2024-01-02 02:00:00')
    })

    it('should format with different patterns', () => {
      const { result } = renderHook(() => useTimestamp())
      const timestamp = 1704132000

      expect(result.current.formatTime(timestamp, 'MM/DD/YYYY'))
        .toBe('01/02/2024')

      expect(result.current.formatTime(timestamp, 'HH:mm'))
        .toBe('02:00')
    })
  })

  describe('formatDate', () => {
    it('should format date string correctly', () => {
      const { result } = renderHook(() => useTimestamp())
      const dateString = '2024-01-01T12:00:00Z'

      expect(result.current.formatDate(dateString, 'YYYY-MM-DD HH:mm:ss'))
        .toBe('2024-01-01 20:00:00')
    })

    it('should format with different patterns', () => {
      const { result } = renderHook(() => useTimestamp())
      const dateString = '2024-01-01T12:00:00Z'

      expect(result.current.formatDate(dateString, 'MM/DD/YYYY'))
        .toBe('01/01/2024')

      expect(result.current.formatDate(dateString, 'HH:mm'))
        .toBe('20:00')
    })
  })
})
