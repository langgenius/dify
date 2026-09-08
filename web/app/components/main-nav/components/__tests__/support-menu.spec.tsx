import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { Mock } from 'vite-plus/test'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { zendeskRuntime } from '@/app/components/base/zendesk/runtime'
import { mailToSupport } from '@/app/components/header/utils/util'
import { useModalContext } from '@/context/modal-context'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import SupportMenu from '../support-menu'

let plan: CloudPlan = 'team'

const {
  mockConfig,
  mockOpenZendeskWindow,
  mockMailToSupport,
  mockSetShowPricingModal,
  mockToastError,
} = vi.hoisted(() => ({
  mockConfig: {
    supportEmailAddress: '',
    zendeskWidgetKey: 'zendesk-key',
  },
  mockOpenZendeskWindow: vi.fn(),
  mockMailToSupport: vi.fn(),
  mockSetShowPricingModal: vi.fn(),
  mockToastError: vi.fn(),
}))
const mockConsoleState = vi.hoisted(() => ({
  current: {
    langGeniusVersionInfo: { current_version: '1.0.0' },
    userProfile: { email: 'user@example.com' },
  },
}))

vi.mock('@/app/components/base/zendesk/runtime', () => ({
  zendeskRuntime: {
    open: mockOpenZendeskWindow,
  },
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: { error: mockToastError },
}))

vi.mock('@/app/components/header/utils/util', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/components/header/utils/util')>()),
  mailToSupport: mockMailToSupport,
}))

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    get SUPPORT_EMAIL_ADDRESS() {
      return mockConfig.supportEmailAddress
    },
    get ZENDESK_WIDGET_KEY() {
      return mockConfig.zendeskWidgetKey
    },
  }
})

vi.mock('@/context/modal-context', () => ({
  useModalContext: vi.fn(),
}))

describe('SupportMenu', () => {
  let deploymentEdition: 'COMMUNITY' | 'ENTERPRISE' | 'CLOUD' = 'CLOUD'

  beforeEach(() => {
    vi.clearAllMocks()
    deploymentEdition = 'CLOUD'
    mockConfig.supportEmailAddress = ''
    mockConfig.zendeskWidgetKey = 'zendesk-key'
    mockOpenZendeskWindow.mockResolvedValue(undefined)
    mockConsoleState.current = {
      langGeniusVersionInfo: { current_version: '1.0.0' },
      userProfile: { email: 'user@example.com' },
    }
    plan = 'team'
    ;(useModalContext as Mock).mockReturnValue({
      setShowPricingModal: mockSetShowPricingModal,
    })
    ;(mailToSupport as Mock).mockReturnValue('mailto:support@example.com')
  })

  const renderSupportMenu = (withPlan = true) => {
    const queryClient = createConsoleQueryClient()
    if (!withPlan && deploymentEdition === 'CLOUD') {
      void queryClient.query({
        ...consoleQuery.features.get.queryOptions(),
        queryFn: () => new Promise(() => {}),
      })
    }
    const { wrapper } = createConsoleQueryWrapper({
      queryClient,
      accountProfile: mockConsoleState.current.userProfile,
      accountProfileMeta: {
        currentVersion: mockConsoleState.current.langGeniusVersionInfo.current_version,
      },
      systemFeatures: { deployment_edition: deploymentEdition },
      ...(withPlan ? { features: { billing: { subscription: { plan } } } } : {}),
    })
    return render(
      <DropdownMenu open={true} onOpenChange={() => {}}>
        <DropdownMenuTrigger>open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <SupportMenu />
        </DropdownMenuContent>
      </DropdownMenu>,
      { wrapper },
    )
  }

  it('renders contact us before Discord when Zendesk is configured', () => {
    renderSupportMenu()

    expect(screen.getByText('common.userProfile.contactUs')).toBeInTheDocument()
    expect(screen.getByText('common.userProfile.discord')).toBeInTheDocument()
    expect(screen.queryByText('common.userProfile.forum')).not.toBeInTheDocument()
    expect(screen.queryByText('common.userProfile.community')).not.toBeInTheDocument()
    expect(
      screen
        .getByText('common.userProfile.contactUs')
        .compareDocumentPosition(screen.getByText('common.userProfile.discord')),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(screen.getByRole('menuitem', { name: 'common.userProfile.discord' })).toHaveClass(
      'mx-0',
      'px-3',
    )

    fireEvent.click(screen.getByRole('menuitem', { name: 'common.userProfile.contactUs' }))

    expect(zendeskRuntime.open).toHaveBeenCalledWith('CLOUD')
  })

  it('reports a Zendesk load failure so the user can retry', async () => {
    mockOpenZendeskWindow.mockRejectedValueOnce(new Error('load failed'))
    renderSupportMenu()

    fireEvent.click(screen.getByRole('menuitem', { name: 'common.userProfile.contactUs' }))

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('common.api.actionFailed'))
  })

  it('renders contact us with upgrade badge for Cloud sandbox plan without dedicated support', () => {
    plan = 'sandbox'

    renderSupportMenu()

    expect(screen.getByText('common.userProfile.contactUs')).toHaveClass('text-text-disabled')
    expect(screen.getByText('billing.upgradeBtn.encourageShort')).toHaveClass(
      'system-xs-semibold-uppercase',
      'text-saas-dify-blue-accessible',
    )
    expect(screen.queryByText('common.userProfile.emailSupport')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'billing.upgradeBtn.encourageShort' }),
    ).not.toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('menuitem', {
        name: 'common.userProfile.contactUs billing.upgradeBtn.encourageShort',
      }),
    )

    expect(mockSetShowPricingModal).toHaveBeenCalled()
    expect(zendeskRuntime.open).not.toHaveBeenCalled()
  })

  it('keeps Zendesk contact us for Cloud sandbox plan with support email and Zendesk configured', () => {
    mockConfig.supportEmailAddress = 'support@example.com'
    plan = 'sandbox'

    renderSupportMenu()

    expect(screen.getByText('common.userProfile.contactUs')).toBeInTheDocument()
    expect(screen.queryByText('billing.upgradeBtn.encourageShort')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'common.userProfile.contactUs' }))

    expect(zendeskRuntime.open).toHaveBeenCalledWith('CLOUD')
    expect(mockSetShowPricingModal).not.toHaveBeenCalled()
  })

  it('keeps email support for Cloud sandbox plan with support email and no Zendesk configured', () => {
    mockConfig.supportEmailAddress = 'support@example.com'
    mockConfig.zendeskWidgetKey = ''
    plan = 'sandbox'

    renderSupportMenu()

    expect(screen.queryByText('common.userProfile.contactUs')).not.toBeInTheDocument()
    expect(screen.getByText('common.userProfile.emailSupport')).toBeInTheDocument()
    expect(screen.queryByText('billing.upgradeBtn.encourageShort')).not.toBeInTheDocument()
    expect(mailToSupport).toHaveBeenCalledWith(
      'user@example.com',
      'sandbox',
      '1.0.0',
      'support@example.com',
    )
  })

  it('hides dedicated support channels for non-Cloud sandbox plan without support email', () => {
    deploymentEdition = 'COMMUNITY'
    plan = 'sandbox'

    renderSupportMenu()

    expect(screen.queryByText('common.userProfile.contactUs')).not.toBeInTheDocument()
    expect(screen.queryByText('common.userProfile.emailSupport')).not.toBeInTheDocument()
    expect(screen.getByText('common.userProfile.discord')).toBeInTheDocument()
  })

  it('renders email support when Zendesk is not configured for a dedicated support channel', () => {
    mockConfig.zendeskWidgetKey = ''

    renderSupportMenu()

    expect(screen.queryByText('common.userProfile.contactUs')).not.toBeInTheDocument()
    expect(screen.getByText('common.userProfile.emailSupport')).toBeInTheDocument()
    expect(mailToSupport).toHaveBeenCalledWith('user@example.com', 'team', '1.0.0', '')
    expect(
      screen.getByRole('menuitem', { name: 'common.userProfile.emailSupport' }),
    ).toHaveAttribute('href', 'mailto:support@example.com')
  })

  it('waits for the Cloud plan before generating a support email', () => {
    mockConfig.supportEmailAddress = 'support@example.com'
    mockConfig.zendeskWidgetKey = ''
    renderSupportMenu(false)

    expect(screen.queryByText('common.userProfile.emailSupport')).not.toBeInTheDocument()
    expect(mailToSupport).not.toHaveBeenCalled()
    expect(screen.getByText('common.userProfile.discord')).toBeInTheDocument()
  })

  it('keeps configured self-hosted email support independent of Cloud plan data', () => {
    deploymentEdition = 'ENTERPRISE'
    mockConfig.supportEmailAddress = 'support@example.com'
    renderSupportMenu(false)

    expect(
      screen.getByRole('menuitem', { name: 'common.userProfile.emailSupport' }),
    ).toHaveAttribute('href', 'mailto:support@example.com')
    expect(mailToSupport).not.toHaveBeenCalled()
  })

  it('has the Discord link and no Forum entry', () => {
    renderSupportMenu()

    const discordLink = screen.getByText('common.userProfile.discord').closest('a')
    expect(discordLink).toHaveAttribute('href', 'https://discord.gg/5AEfbxcd9k')
    expect(screen.queryByText('common.userProfile.forum')).not.toBeInTheDocument()
    expect(screen.queryByText('common.userProfile.community')).not.toBeInTheDocument()
  })
})
