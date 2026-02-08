import type { SiteInfo } from '@/models/share'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MenuDropdown from './menu-dropdown'

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock next/navigation
const mockReplace = vi.fn()
const mockPathname = '/test-path'
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  usePathname: () => mockPathname,
}))

// Mock web-app-context
const mockShareCode = 'test-share-code'
vi.mock('@/context/web-app-context', () => ({
  useWebAppStore: (selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      webAppAccessMode: 'code',
      shareCode: mockShareCode,
    }
    return selector(state)
  },
}))

// Mock webapp-auth service
const mockWebAppLogout = vi.fn().mockResolvedValue(undefined)
vi.mock('@/service/webapp-auth', () => ({
  webAppLogout: (...args: unknown[]) => mockWebAppLogout(...args),
}))

afterEach(() => {
  cleanup()
})

describe('MenuDropdown', () => {
  const baseSiteInfo: SiteInfo = {
    title: 'Test App',
    icon: '🚀',
    icon_type: 'emoji',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render the trigger button', () => {
      render(<MenuDropdown data={baseSiteInfo} />)

      // The trigger button contains a settings icon (RiEqualizer2Line)
      const triggerButton = screen.getByRole('button')
      expect(triggerButton).toBeInTheDocument()
    })

    it('should not show dropdown content initially', () => {
      render(<MenuDropdown data={baseSiteInfo} />)

      // Dropdown content should not be visible initially
      expect(screen.queryByText('theme.theme')).not.toBeInTheDocument()
    })

    it('should show dropdown content when clicked', async () => {
      render(<MenuDropdown data={baseSiteInfo} />)

      const triggerButton = screen.getByRole('button')
      fireEvent.click(triggerButton)

      await waitFor(() => {
        expect(screen.getByText('theme.theme')).toBeInTheDocument()
      })
    })

    it('should show About option in dropdown', async () => {
      render(<MenuDropdown data={baseSiteInfo} />)

      const triggerButton = screen.getByRole('button')
      fireEvent.click(triggerButton)

      await waitFor(() => {
        expect(screen.getByText('userProfile.about')).toBeInTheDocument()
      })
    })
  })

  describe('privacy policy link', () => {
    it('should show privacy policy link when provided', async () => {
      const siteInfoWithPrivacy: SiteInfo = {
        ...baseSiteInfo,
        privacy_policy: 'https://example.com/privacy',
      }

      render(<MenuDropdown data={siteInfoWithPrivacy} />)

      const triggerButton = screen.getByRole('button')
      fireEvent.click(triggerButton)

      await waitFor(() => {
        expect(screen.getByText('chat.privacyPolicyMiddle')).toBeInTheDocument()
      })
    })

    it('should not show privacy policy link when not provided', async () => {
      render(<MenuDropdown data={baseSiteInfo} />)

      const triggerButton = screen.getByRole('button')
      fireEvent.click(triggerButton)

      await waitFor(() => {
        expect(screen.queryByText('chat.privacyPolicyMiddle')).not.toBeInTheDocument()
      })
    })

    it('should have correct href for privacy policy link', async () => {
      const privacyUrl = 'https://example.com/privacy'
      const siteInfoWithPrivacy: SiteInfo = {
        ...baseSiteInfo,
        privacy_policy: privacyUrl,
      }

      render(<MenuDropdown data={siteInfoWithPrivacy} />)

      const triggerButton = screen.getByRole('button')
      fireEvent.click(triggerButton)

      await waitFor(() => {
        const link = screen.getByText('chat.privacyPolicyMiddle').closest('a')
        expect(link).toHaveAttribute('href', privacyUrl)
        expect(link).toHaveAttribute('target', '_blank')
      })
    })
  })

  describe('logout functionality', () => {
    it('should show logout option when hideLogout is false', async () => {
      render(<MenuDropdown data={baseSiteInfo} hideLogout={false} />)

      const triggerButton = screen.getByRole('button')
      fireEvent.click(triggerButton)

      await waitFor(() => {
        expect(screen.getByText('userProfile.logout')).toBeInTheDocument()
      })
    })

    it('should hide logout option when hideLogout is true', async () => {
      render(<MenuDropdown data={baseSiteInfo} hideLogout={true} />)

      const triggerButton = screen.getByRole('button')
      fireEvent.click(triggerButton)

      await waitFor(() => {
        expect(screen.queryByText('userProfile.logout')).not.toBeInTheDocument()
      })
    })

    it('should call webAppLogout and redirect when logout is clicked', async () => {
      render(<MenuDropdown data={baseSiteInfo} hideLogout={false} />)

      const triggerButton = screen.getByRole('button')
      fireEvent.click(triggerButton)

      await waitFor(() => {
        expect(screen.getByText('userProfile.logout')).toBeInTheDocument()
      })

      const logoutButton = screen.getByText('userProfile.logout')
      await act(async () => {
        fireEvent.click(logoutButton)
      })

      await waitFor(() => {
        expect(mockWebAppLogout).toHaveBeenCalledWith(mockShareCode)
        expect(mockReplace).toHaveBeenCalledWith(`/webapp-signin?redirect_url=${mockPathname}`)
      })
    })
  })

  describe('about modal', () => {
    it('should show InfoModal when About is clicked', async () => {
      render(<MenuDropdown data={baseSiteInfo} />)

      const triggerButton = screen.getByRole('button')
      fireEvent.click(triggerButton)

      await waitFor(() => {
        expect(screen.getByText('userProfile.about')).toBeInTheDocument()
      })

      const aboutButton = screen.getByText('userProfile.about')
      fireEvent.click(aboutButton)

      await waitFor(() => {
        expect(screen.getByText('Test App')).toBeInTheDocument()
      })
    })
  })

  describe('forceClose prop', () => {
    it('should close dropdown when forceClose changes to true', async () => {
      const { rerender } = render(<MenuDropdown data={baseSiteInfo} forceClose={false} />)

      const triggerButton = screen.getByRole('button')
      fireEvent.click(triggerButton)

      await waitFor(() => {
        expect(screen.getByText('theme.theme')).toBeInTheDocument()
      })

      rerender(<MenuDropdown data={baseSiteInfo} forceClose={true} />)

      await waitFor(() => {
        expect(screen.queryByText('theme.theme')).not.toBeInTheDocument()
      })
    })
  })

  describe('placement prop', () => {
    it('should accept custom placement', () => {
      render(<MenuDropdown data={baseSiteInfo} placement="top-start" />)

      const triggerButton = screen.getByRole('button')
      expect(triggerButton).toBeInTheDocument()
    })
  })

  describe('toggle behavior', () => {
    it('should close dropdown when clicking trigger again', async () => {
      render(<MenuDropdown data={baseSiteInfo} />)

      const triggerButton = screen.getByRole('button')

      // Open
      fireEvent.click(triggerButton)
      await waitFor(() => {
        expect(screen.getByText('theme.theme')).toBeInTheDocument()
      })

      // Close
      fireEvent.click(triggerButton)
      await waitFor(() => {
        expect(screen.queryByText('theme.theme')).not.toBeInTheDocument()
      })
    })
  })

  describe('memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect((MenuDropdown as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
    })
  })
})
