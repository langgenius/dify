import type { AppContextValue } from '@/context/app-context'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@langgenius/dify-ui/dropdown-menu'
import { fireEvent, render, screen } from '@testing-library/react'
import { Plan } from '@/app/components/billing/type'
import { useAppContext } from '@/context/app-context'
import { baseProviderContextValue, useProviderContext } from '@/context/provider-context'
import SupportMenu from '../support-menu'

const { mockZendeskKey } = vi.hoisted(() => ({
  mockZendeskKey: { value: 'test-key' },
}))

const { mockSupportEmailKey } = vi.hoisted(() => ({
  mockSupportEmailKey: { value: '' },
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
    get ZENDESK_WIDGET_KEY() { return mockZendeskKey.value || '' },
    get SUPPORT_EMAIL_ADDRESS() { return mockSupportEmailKey.value || '' },
  }
})

describe('SupportMenu', () => {
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
    mockSupportEmailKey.value = ''
    vi.mocked(useAppContext).mockReturnValue(baseAppContextValue)
    vi.mocked(useProviderContext).mockReturnValue({
      ...baseProviderContextValue,
      plan: {
        ...baseProviderContextValue.plan,
        type: Plan.professional,
      },
    })
  })

  const renderSupportMenu = () => {
    return render(
      <DropdownMenu open={true} onOpenChange={() => { }}>
        <DropdownMenuTrigger>open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <SupportMenu />
        </DropdownMenuContent>
      </DropdownMenu>,
    )
  }

  it('renders the main nav support menu trigger with local row spacing', () => {
    renderSupportMenu()

    expect(screen.getByText('common.userProfile.support')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'common.userProfile.support' })).toHaveClass('mx-0', 'px-3')
  })

  it('shows forum and community links when opened', () => {
    renderSupportMenu()
    fireEvent.click(screen.getByText('common.userProfile.support'))

    expect(screen.getByText('common.userProfile.forum')).toBeInTheDocument()
    expect(screen.getByText('common.userProfile.community')).toBeInTheDocument()
  })

  it('shows "Contact Us" when ZENDESK_WIDGET_KEY is present', () => {
    renderSupportMenu()
    fireEvent.click(screen.getByText('common.userProfile.support'))

    expect(screen.getByText('common.userProfile.contactUs')).toBeInTheDocument()
  })

  it('hides dedicated support channels for Sandbox plan', () => {
    vi.mocked(useProviderContext).mockReturnValue({
      ...baseProviderContextValue,
      plan: {
        ...baseProviderContextValue.plan,
        type: Plan.sandbox,
      },
    })

    renderSupportMenu()
    fireEvent.click(screen.getByText('common.userProfile.support'))

    expect(screen.queryByText('common.userProfile.contactUs')).not.toBeInTheDocument()
    expect(screen.queryByText('common.userProfile.emailSupport')).not.toBeInTheDocument()
  })

  it('shows "Email Support" when ZENDESK_WIDGET_KEY is absent', () => {
    mockZendeskKey.value = ''

    renderSupportMenu()
    fireEvent.click(screen.getByText('common.userProfile.support'))

    expect(screen.getByText('common.userProfile.emailSupport')).toBeInTheDocument()
    expect(screen.queryByText('common.userProfile.contactUs')).not.toBeInTheDocument()
  })

  it('shows Email Support when ZENDESK_WIDGET_KEY is null', () => {
    mockZendeskKey.value = null as unknown as string

    renderSupportMenu()
    fireEvent.click(screen.getByText('common.userProfile.support'))

    expect(screen.getByText('common.userProfile.emailSupport')).toBeInTheDocument()
    expect(screen.queryByText('common.userProfile.contactUs')).not.toBeInTheDocument()
  })

  it('calls toggleZendeskWindow when "Contact Us" is clicked', () => {
    renderSupportMenu()
    fireEvent.click(screen.getByText('common.userProfile.support'))
    fireEvent.click(screen.getByText('common.userProfile.contactUs'))

    expect(window.zE).toHaveBeenCalledWith('messenger', 'open')
  })

  it('has correct forum and community links', () => {
    renderSupportMenu()
    fireEvent.click(screen.getByText('common.userProfile.support'))

    const forumLink = screen.getByText('common.userProfile.forum').closest('a')
    const communityLink = screen.getByText('common.userProfile.community').closest('a')
    expect(forumLink).toHaveAttribute('href', 'https://forum.dify.ai/')
    expect(communityLink).toHaveAttribute('href', 'https://discord.gg/5AEfbxcd9k')
  })
})
