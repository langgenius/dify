import type { AppContextValue } from '@/context/app-context'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toggleZendeskWindow } from '@/app/components/base/zendesk/utils'
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
    get ZENDESK_WIDGET_KEY() { return mockZendeskKey.value },
  }
})

vi.mock('@/app/components/base/zendesk/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/base/zendesk/utils')>()
  return {
    ...actual,
    toggleZendeskWindow: vi.fn(),
  }
})

vi.mock('../utils/util', () => ({
  mailToSupport: vi.fn(() => 'mailto:support@dify.ai'),
}))

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

  it('renders support menu trigger', () => {
    render(<Support closeAccountDropdown={mockCloseAccountDropdown} />)
    expect(screen.getByText('common.userProfile.support')).toBeDefined()
  })

  it('shows forum and community links when opened', () => {
    render(<Support closeAccountDropdown={mockCloseAccountDropdown} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('common.userProfile.forum')).toBeDefined()
    expect(screen.getByText('common.userProfile.community')).toBeDefined()
  })

  it('shows "Contact Us" when ZENDESK_WIDGET_KEY is present', () => {
    render(<Support closeAccountDropdown={mockCloseAccountDropdown} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('common.userProfile.contactUs')).toBeDefined()
  })

  it('hides dedicated support channels for Sandbox plan', () => {
    vi.mocked(useProviderContext).mockReturnValue({
      ...baseProviderContextValue,
      plan: {
        ...baseProviderContextValue.plan,
        type: Plan.sandbox,
      },
    })
    render(<Support closeAccountDropdown={mockCloseAccountDropdown} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByText('common.userProfile.contactUs')).toBeNull()
    expect(screen.queryByText('common.userProfile.emailSupport')).toBeNull()
  })

  it('calls toggleZendeskWindow and closeAccountDropdown when "Contact Us" is clicked', () => {
    render(<Support closeAccountDropdown={mockCloseAccountDropdown} />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('common.userProfile.contactUs'))
    expect(toggleZendeskWindow).toHaveBeenCalledWith(true)
    expect(mockCloseAccountDropdown).toHaveBeenCalled()
  })

  it('shows "Email Support" when ZENDESK_WIDGET_KEY is absent', () => {
    mockZendeskKey.value = ''
    render(<Support closeAccountDropdown={mockCloseAccountDropdown} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('common.userProfile.emailSupport')).toBeDefined()
    expect(screen.queryByText('common.userProfile.contactUs')).toBeNull()
  })

  it('has correct forum and community links', () => {
    render(<Support closeAccountDropdown={mockCloseAccountDropdown} />)
    fireEvent.click(screen.getByRole('button'))
    const forumLink = screen.getByText('common.userProfile.forum').closest('a')
    const communityLink = screen.getByText('common.userProfile.community').closest('a')
    expect(forumLink).toHaveAttribute('href', 'https://forum.dify.ai/')
    expect(communityLink).toHaveAttribute('href', 'https://discord.gg/5AEfbxcd9k')
  })
})
