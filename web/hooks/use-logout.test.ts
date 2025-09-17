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

describe('useLogout Hook', () => {
  const mockPush = jest.fn()
  const mockSetShowLogoutModal = jest.fn()
  const { logout } = require('@/service/common')
  const mockLogout = logout as jest.MockedFunction<typeof logout>

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
    })
    ;(useModalContext as jest.Mock).mockReturnValue({
      setShowLogoutModal: mockSetShowLogoutModal,
    })
    mockLogout.mockResolvedValue({} as any)

    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        removeItem: jest.fn(),
      },
      writable: true,
    })
  })

  describe('Basic logout flow', () => {
    it('should show confirmation modal by default', async () => {
      const { result } = renderHook(() => useLogout())

      await act(async () => {
        result.current.handleLogout({ source: 'header' })
      })

      expect(mockSetShowLogoutModal).toHaveBeenCalledWith({
        source: 'header',
        isWebApp: undefined,
        onConfirm: expect.any(Function),
      })
      expect(mockLogout).not.toHaveBeenCalled()
    })

    it('should skip confirmation when skipConfirm is true', async () => {
      const { result } = renderHook(() => useLogout())

      await act(async () => {
        await result.current.handleLogout({
          source: 'delete-account',
          skipConfirm: true,
        })
      })

      expect(mockSetShowLogoutModal).not.toHaveBeenCalled()
      expect(mockLogout).toHaveBeenCalledWith({
        url: '/logout',
        params: {},
      })
      expect(mockPush).toHaveBeenCalledWith('/signin')
    })
  })

  describe('localStorage cleanup', () => {
    it('should remove standard items for console logout', async () => {
      const { result } = renderHook(() => useLogout())

      await act(async () => {
        await result.current.handleLogout({
          source: 'header',
          skipConfirm: true,
        })
      })

      const { removeItem } = window.localStorage
      expect(removeItem).toHaveBeenCalledWith('setup_status')
      expect(removeItem).toHaveBeenCalledWith('console_token')
      expect(removeItem).toHaveBeenCalledWith('refresh_token')
      expect(removeItem).toHaveBeenCalledWith('education-reverify-prev-expire-at')
      expect(removeItem).toHaveBeenCalledWith('education-reverify-has-noticed')
      expect(removeItem).toHaveBeenCalledWith('education-expired-has-noticed')
    })

    it('should remove additional items for webapp logout', async () => {
      const { result } = renderHook(() => useLogout())

      await act(async () => {
        await result.current.handleLogout({
          source: 'share-app',
          skipConfirm: true,
          isWebApp: true,
        })
      })

      const { removeItem } = window.localStorage
      expect(removeItem).toHaveBeenCalledWith('token')
      expect(removeItem).toHaveBeenCalledWith('webapp_access_token')
    })

    it('should always remove education items regardless of source', async () => {
      const { result } = renderHook(() => useLogout())

      const sources = ['header', 'account', 'share-app', 'education', 'delete-account', 'email-change']

      for (const source of sources) {
        jest.clearAllMocks()

        await act(async () => {
          await result.current.handleLogout({
            source: source as any,
            skipConfirm: true,
          })
        })

        const { removeItem } = window.localStorage
        expect(removeItem).toHaveBeenCalledWith('education-reverify-prev-expire-at')
        expect(removeItem).toHaveBeenCalledWith('education-reverify-has-noticed')
        expect(removeItem).toHaveBeenCalledWith('education-expired-has-noticed')
      }
    })
  })

  describe('Redirect behavior', () => {
    it('should redirect to /signin for console logout', async () => {
      const { result } = renderHook(() => useLogout())

      await act(async () => {
        await result.current.handleLogout({
          source: 'header',
          skipConfirm: true,
        })
      })

      expect(mockPush).toHaveBeenCalledWith('/signin')
    })

    it('should redirect to /webapp-signin for webapp logout', async () => {
      const { result } = renderHook(() => useLogout())

      await act(async () => {
        await result.current.handleLogout({
          source: 'share-app',
          skipConfirm: true,
          isWebApp: true,
        })
      })

      expect(mockPush).toHaveBeenCalledWith('/webapp-signin')
    })

    it('should use custom redirect URL when provided', async () => {
      const { result } = renderHook(() => useLogout())
      const customUrl = '/webapp-signin?redirect_url=/chat/123'

      await act(async () => {
        await result.current.handleLogout({
          source: 'share-app',
          skipConfirm: true,
          redirectUrl: customUrl,
        })
      })

      expect(mockPush).toHaveBeenCalledWith(customUrl)
    })
  })

  describe('Success callback', () => {
    it('should call onSuccess callback after successful logout', async () => {
      const onSuccess = jest.fn()
      const { result } = renderHook(() => useLogout())

      await act(async () => {
        await result.current.handleLogout({
          source: 'delete-account',
          skipConfirm: true,
          onSuccess,
        })
      })

      expect(onSuccess).toHaveBeenCalled()
    })

    it('should not call onSuccess if logout fails', async () => {
      mockLogout.mockRejectedValue(new Error('Network error'))
      const onSuccess = jest.fn()
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
      const { result } = renderHook(() => useLogout())

      await act(async () => {
        await result.current.handleLogout({
          source: 'header',
          skipConfirm: true,
          onSuccess,
        })
      })

      expect(onSuccess).not.toHaveBeenCalled()
      expect(consoleSpy).toHaveBeenCalledWith('Logout failed:', expect.any(Error))

      consoleSpy.mockRestore()
    })
  })

  describe('Modal confirmation flow', () => {
    it('should execute logout when modal onConfirm is called', async () => {
      const { result } = renderHook(() => useLogout())

      await act(async () => {
        result.current.handleLogout({ source: 'header' })
      })

      expect(mockSetShowLogoutModal).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'header',
          onConfirm: expect.any(Function),
        }),
      )

      // Get the onConfirm function that was passed to modal
      const modalCall = mockSetShowLogoutModal.mock.calls[0][0]

      // Execute the onConfirm callback
      await act(async () => {
        await modalCall.onConfirm()
      })

      expect(mockLogout).toHaveBeenCalledWith({
        url: '/logout',
        params: {},
      })
      expect(mockPush).toHaveBeenCalledWith('/signin')
    })
  })

  describe('Special scenarios', () => {
    it('should handle delete account scenario correctly', async () => {
      const onSuccess = jest.fn()
      const { result } = renderHook(() => useLogout())

      await act(async () => {
        await result.current.handleLogout({
          source: 'delete-account',
          skipConfirm: true,
          onSuccess,
        })
      })

      expect(mockSetShowLogoutModal).not.toHaveBeenCalled()
      expect(mockLogout).toHaveBeenCalled()
      expect(onSuccess).toHaveBeenCalled()
    })

    it('should handle email change scenario correctly', async () => {
      const { result } = renderHook(() => useLogout())

      await act(async () => {
        await result.current.handleLogout({
          source: 'email-change',
          skipConfirm: true,
        })
      })

      expect(mockSetShowLogoutModal).not.toHaveBeenCalled()
      expect(mockLogout).toHaveBeenCalled()
      expect(mockPush).toHaveBeenCalledWith('/signin')
    })
  })
})
