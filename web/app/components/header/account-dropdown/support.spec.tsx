import type { AppContextValue } from '@/context/app-context'
import { fireEvent, render, screen } from '@testing-library/react'

import { Plan } from '@/app/components/billing/type'
import { useAppContext } from '@/context/app-context'
import { baseProviderContextValue, useProviderContext } from '@/context/provider-context'
import Support from './support'

const { mockZendeskKey } = vi.hoisted(() => ({
  mockZendeskKey: { value: 'test-key' },
}))

vi.mock('@/context/app-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/app-context')>()
  return {
    ...actual,
    useAppContext: vi.fn(),
  }
})

vi.mock('@/context/provider-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/provider-context')>()
  return {
    ...actual,
    useProviderContext: vi.fn(),
  }
})

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    IS_CE_EDITION: false,
    get ZENDESK_WIDGET_KEY() { return mockZendeskKey.value },
  }
})

describe('Support', () => {
  const mockCloseAccountDropdown = vi.fn()

  const baseAppContextValue: AppContextValue = {
    userProfile: {
      id: '1',
      name: 'Test User',
      email: 'test@example.com',
      avatar: '',
      avatar_url: '',
      is_password_set: false,
    },
    mutateUserProfile: vi.fn(),
    currentWorkspace: {
      id: '1',
      name: 'Workspace',
      plan: '',
      status: '',
      created_at: 0,
      role: 'owner',
      providers: [],
      trial_credits: 0,
      trial_credits_used: 0,
      next_credit_reset_date: 0,
    },
    isCurrentWorkspaceManager: true,
    isCurrentWorkspaceOwner: true,
    isCurrentWorkspaceEditor: true,
    isCurrentWorkspaceDatasetOperator: false,
    mutateCurrentWorkspace: vi.fn(),
    langGeniusVersionInfo: {
      current_env: 'testing',
      current_version: '0.6.0',
      latest_version: '0.6.0',
      release_date: '',
      release_notes: '',
      version: '0.6.0',
      can_auto_update: false,
    },
    useSelector: vi.fn(),
    isLoadingCurrentWorkspace: false,
    isValidatingCurrentWorkspace: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    window.zE = vi.fn()
    mockZendeskKey.value = 'test-key'
    vi.mocked(useAppContext).mockReturnValue(baseAppContextValue)
    vi.mocked(useProviderContext).mockReturnValue({
      ...baseProviderContextValue,
      plan: {
        ...baseProviderContextValue.plan,
        type: Plan.professional,
      },
    })
  })

  describe('Rendering', () => {
    it('should render support menu trigger', () => {
      // Act
      render(<Support closeAccountDropdown={mockCloseAccountDropdown} />)

      // Assert
      expect(screen.getByText('common.userProfile.support')).toBeInTheDocument()
    })

    it('should show forum and community links when opened', () => {
      // Act
      render(<Support closeAccountDropdown={mockCloseAccountDropdown} />)
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(screen.getByText('common.userProfile.forum')).toBeInTheDocument()
      expect(screen.getByText('common.userProfile.community')).toBeInTheDocument()
    })
  })

  describe('Plan-based Channels', () => {
    it('should show "Contact Us" when ZENDESK_WIDGET_KEY is present', () => {
      // Act
      render(<Support closeAccountDropdown={mockCloseAccountDropdown} />)
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(screen.getByText('common.userProfile.contactUs')).toBeInTheDocument()
    })

    it('should hide dedicated support channels for Sandbox plan', () => {
      // Arrange
      vi.mocked(useProviderContext).mockReturnValue({
        ...baseProviderContextValue,
        plan: {
          ...baseProviderContextValue.plan,
          type: Plan.sandbox,
        },
      })

      // Act
      render(<Support closeAccountDropdown={mockCloseAccountDropdown} />)
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(screen.queryByText('common.userProfile.contactUs')).not.toBeInTheDocument()
      expect(screen.queryByText('common.userProfile.emailSupport')).not.toBeInTheDocument()
    })

    it('should show "Email Support" when ZENDESK_WIDGET_KEY is absent', () => {
      // Arrange
      mockZendeskKey.value = ''

      // Act
      render(<Support closeAccountDropdown={mockCloseAccountDropdown} />)
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(screen.getByText('common.userProfile.emailSupport')).toBeInTheDocument()
      expect(screen.queryByText('common.userProfile.contactUs')).not.toBeInTheDocument()
    })
  })

  describe('Interactions and Links', () => {
    it('should call toggleZendeskWindow and closeAccountDropdown when "Contact Us" is clicked', () => {
      // Act
      render(<Support closeAccountDropdown={mockCloseAccountDropdown} />)
      fireEvent.click(screen.getByRole('button'))
      fireEvent.click(screen.getByText('common.userProfile.contactUs'))

      // Assert
      expect(window.zE).toHaveBeenCalledWith('messenger', 'open')
      expect(mockCloseAccountDropdown).toHaveBeenCalled()
    })

    it('should have correct forum and community links', () => {
      // Act
      render(<Support closeAccountDropdown={mockCloseAccountDropdown} />)
      fireEvent.click(screen.getByRole('button'))

      // Assert
      const forumLink = screen.getByText('common.userProfile.forum').closest('a')
      const communityLink = screen.getByText('common.userProfile.community').closest('a')
      expect(forumLink).toHaveAttribute('href', 'https://forum.dify.ai/')
      expect(communityLink).toHaveAttribute('href', 'https://discord.gg/5AEfbxcd9k')
    })
  })
})
