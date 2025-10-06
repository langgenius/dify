import { act, renderHook } from '@testing-library/react'
import { useRouter } from 'next/navigation'
import useLogout from './use-logout'
import { useModalContext } from '@/context/modal-context'

// Mock dependencies
jest.mock('next/navigation')
jest.mock('@/context/modal-context')

// Mock the logout service
jest.mock('@/service/common', () => ({
  logout: jest.fn(() => Promise.resolve({})),
}))

describe('Logout Integration Tests - All Scenarios', () => {
  const mockPush = jest.fn()
  const mockSetShowLogoutModal = jest.fn()
  const { logout: mockLogout } = require('@/service/common')

  const localStorageItems = [
    'setup_status',
    'console_token',
    'refresh_token',
    'education-reverify-prev-expire-at',
    'education-reverify-has-noticed',
    'education-expired-has-noticed',
    'token',
    'webapp_access_token',
  ]

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
    })
    ;(useModalContext as jest.Mock).mockReturnValue({
      setShowLogoutModal: mockSetShowLogoutModal,
    })
    mockLogout.mockResolvedValue({})

    // Setup localStorage mock
    const localStorageMock: { [key: string]: string } = {}
    localStorageItems.forEach((item) => {
      localStorageMock[item] = 'test-value'
    })

    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn((key: string) => localStorageMock[key] || null),
        setItem: jest.fn((key: string, value: string) => {
          localStorageMock[key] = value
        }),
        removeItem: jest.fn((key: string) => {
          delete localStorageMock[key]
        }),
        clear: jest.fn(() => {
          Object.keys(localStorageMock).forEach(key => delete localStorageMock[key])
        }),
        ...localStorageMock,
      },
      writable: true,
    })
  })

  describe('Scenario 1: Header Dropdown Logout', () => {
    it('should handle header dropdown logout with confirmation', async () => {
      const { result } = renderHook(() => useLogout())

      await act(async () => {
        await result.current.handleLogout({
          source: 'header',
          skipConfirm: true,
        })
      })

      // Verify API call
      expect(mockLogout).toHaveBeenCalledWith({
        url: '/logout',
        params: {},
      })

      // Verify localStorage cleanup
      const { removeItem } = window.localStorage
      expect(removeItem).toHaveBeenCalledWith('setup_status')
      expect(removeItem).toHaveBeenCalledWith('console_token')
      expect(removeItem).toHaveBeenCalledWith('refresh_token')
      expect(removeItem).toHaveBeenCalledWith('education-reverify-prev-expire-at')
      expect(removeItem).toHaveBeenCalledWith('education-reverify-has-noticed')
      expect(removeItem).toHaveBeenCalledWith('education-expired-has-noticed')
    })
  })

  describe('Scenario 2: Account Settings Logout', () => {
    it('should handle account settings logout', async () => {
      const { result } = renderHook(() => useLogout())

      await act(async () => {
        await result.current.handleLogout({
          source: 'account',
          skipConfirm: true,
        })
      })

      expect(mockLogout).toHaveBeenCalled()
      const { removeItem } = window.localStorage
      expect(removeItem).toHaveBeenCalledWith('education-reverify-prev-expire-at')
      expect(removeItem).toHaveBeenCalledWith('education-reverify-has-noticed')
      expect(removeItem).toHaveBeenCalledWith('education-expired-has-noticed')
    })
  })

  describe('Scenario 3: Share App Logout', () => {
    it('should handle webapp logout with additional tokens', async () => {
      const { result } = renderHook(() => useLogout())

      await act(async () => {
        await result.current.handleLogout({
          source: 'share-app',
          isWebApp: true,
          skipConfirm: true,
          redirectUrl: '/webapp-signin?redirect_url=/chat/123',
        })
      })

      expect(mockLogout).toHaveBeenCalled()
      const { removeItem } = window.localStorage
      // Should remove webapp specific tokens
      expect(removeItem).toHaveBeenCalledWith('token')
      expect(removeItem).toHaveBeenCalledWith('webapp_access_token')
      // Also standard tokens
      expect(removeItem).toHaveBeenCalledWith('console_token')
      expect(removeItem).toHaveBeenCalledWith('refresh_token')
    })
  })

  describe('Scenario 4: Education Page Logout', () => {
    it('should handle education page logout', async () => {
      const { result } = renderHook(() => useLogout())

      await act(async () => {
        await result.current.handleLogout({
          source: 'education',
          skipConfirm: true,
        })
      })

      expect(mockLogout).toHaveBeenCalled()
      const { removeItem } = window.localStorage
      // Should always remove education items
      expect(removeItem).toHaveBeenCalledWith('education-reverify-prev-expire-at')
      expect(removeItem).toHaveBeenCalledWith('education-reverify-has-noticed')
      expect(removeItem).toHaveBeenCalledWith('education-expired-has-noticed')
    })
  })

  describe('Scenario 5: Delete Account', () => {
    it('should skip confirmation and call success callback', async () => {
      const onSuccess = jest.fn()
      const { result } = renderHook(() => useLogout())

      await act(async () => {
        await result.current.handleLogout({
          source: 'delete-account',
          skipConfirm: true,
          onSuccess,
        })
      })

      expect(mockLogout).toHaveBeenCalled()
      expect(onSuccess).toHaveBeenCalled()

      // Verify all standard items are cleaned
      const { removeItem } = window.localStorage
      expect(removeItem).toHaveBeenCalledWith('setup_status')
      expect(removeItem).toHaveBeenCalledWith('console_token')
      expect(removeItem).toHaveBeenCalledWith('refresh_token')
    })
  })

  describe('Scenario 6: Email Change', () => {
    it('should skip confirmation for email change', async () => {
      const { result } = renderHook(() => useLogout())

      await act(async () => {
        await result.current.handleLogout({
          source: 'email-change',
          skipConfirm: true,
        })
      })

      expect(mockLogout).toHaveBeenCalled()

      // Verify standard cleanup
      const { removeItem } = window.localStorage
      expect(removeItem).toHaveBeenCalledWith('setup_status')
      expect(removeItem).toHaveBeenCalledWith('console_token')
      expect(removeItem).toHaveBeenCalledWith('refresh_token')
    })
  })

  describe('Scenario 7: Chat Sidebar Logout', () => {
    it('should handle chat sidebar logout', async () => {
      const { result } = renderHook(() => useLogout())

      await act(async () => {
        await result.current.handleLogout({
          source: 'chat-sidebar',
          skipConfirm: true,
        })
      })

      expect(mockLogout).toHaveBeenCalled()
      expect(mockPush).toHaveBeenCalledWith('/signin')

      // Verify standard cleanup
      const { removeItem } = window.localStorage
      expect(removeItem).toHaveBeenCalledWith('setup_status')
      expect(removeItem).toHaveBeenCalledWith('console_token')
      expect(removeItem).toHaveBeenCalledWith('refresh_token')
    })
  })

  describe('Error Handling', () => {
    it('should handle logout API failure gracefully', async () => {
      mockLogout.mockRejectedValue(new Error('Network error'))
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
      const onSuccess = jest.fn()

      const { result } = renderHook(() => useLogout())

      await act(async () => {
        await result.current.handleLogout({
          source: 'header',
          skipConfirm: true,
          onSuccess,
        })
      })

      // Should log error but not crash
      expect(consoleSpy).toHaveBeenCalledWith('Logout failed:', expect.any(Error))
      expect(onSuccess).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  describe('Modal Confirmation', () => {
    it('should show modal for scenarios without skipConfirm', async () => {
      const { result } = renderHook(() => useLogout())

      // Test scenarios that should show modal
      const modalScenarios = ['header', 'account', 'share-app', 'education', 'chat-sidebar']

      for (const source of modalScenarios) {
        jest.clearAllMocks()

        await act(async () => {
          result.current.handleLogout({ source: source as any })
        })

        expect(mockSetShowLogoutModal).toHaveBeenCalledWith({
          source,
          isWebApp: undefined,
          onConfirm: expect.any(Function),
        })
      }
    })
  })

  describe('Backward Compatibility', () => {
    it('should maintain backward compatibility for all scenarios', async () => {
      const scenarios = [
        { source: 'header' as const, expectedRedirect: '/signin' },
        { source: 'account' as const, expectedRedirect: '/signin' },
        { source: 'share-app' as const, isWebApp: true, expectedRedirect: '/webapp-signin' },
        { source: 'education' as const, expectedRedirect: '/signin' },
        { source: 'delete-account' as const, skipConfirm: true, expectedRedirect: '/signin' },
        { source: 'email-change' as const, skipConfirm: true, expectedRedirect: '/signin' },
        { source: 'chat-sidebar' as const, expectedRedirect: '/signin' },
      ]

      for (const scenario of scenarios) {
        jest.clearAllMocks()
        const { result } = renderHook(() => useLogout())

        await act(async () => {
          await result.current.handleLogout({
            ...scenario,
            skipConfirm: true,
          })
        })

        // All scenarios should call logout API
        expect(mockLogout).toHaveBeenCalledWith({
          url: '/logout',
          params: {},
        })

        // All scenarios should clean education items (unified behavior)
        const { removeItem } = window.localStorage
        expect(removeItem).toHaveBeenCalledWith('education-reverify-prev-expire-at')
        expect(removeItem).toHaveBeenCalledWith('education-reverify-has-noticed')
        expect(removeItem).toHaveBeenCalledWith('education-expired-has-noticed')

        // Verify redirect
        expect(mockPush).toHaveBeenCalledWith(scenario.expectedRedirect)
      }
    })
  })
})
