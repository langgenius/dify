import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { Mock } from 'vite-plus/test'
import { Menu, MenuContent, MenuTrigger } from '@langgenius/dify-ui/menu'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { zendeskRuntime } from '@/app/components/base/zendesk/runtime'
import { mailToSupport } from '@/app/components/header/utils/util'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import { render as renderWithoutPricing } from '@/test/console/render'
import SupportMenu from '../support-menu'

let plan: CloudPlan = 'team'

const { mockConfig, mockOpenZendeskWindow, mockMailToSupport, onPricingUrlUpdate, mockToastError } =
  vi.hoisted(() => ({
    mockConfig: {
      supportEmailAddress: '',
      zendeskWidgetKey: 'zendesk-key',
    },
    mockOpenZendeskWindow: vi.fn(),
    mockMailToSupport: vi.fn(),
    onPricingUrlUpdate: vi.fn(),
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

vi.mock('@/app/notifications', () => ({
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

function render(...args: Parameters<typeof renderWithoutPricing>) {
  args[0] = <NuqsTestingAdapter onUrlUpdate={onPricingUrlUpdate}>{args[0]}</NuqsTestingAdapter>
  return renderWithoutPricing(...args)
}

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
      <Menu open={true} onOpenChange={() => {}}>
        <MenuTrigger>open</MenuTrigger>
        <MenuContent>
          <SupportMenu />
        </MenuContent>
      </Menu>,
      { wrapper },
    )
  }

  it('renders contact us before Discord when Zendesk is configured', async () => {
    const user = userEvent.setup()
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

    await user.click(screen.getByRole('menuitem', { name: 'common.userProfile.contactUs' }))

    expect(zendeskRuntime.open).toHaveBeenCalledWith('CLOUD')
  })

  it('reports a Zendesk load failure so the user can retry', async () => {
    const user = userEvent.setup()
    mockOpenZendeskWindow.mockRejectedValueOnce(new Error('load failed'))
    renderSupportMenu()

    await user.click(screen.getByRole('menuitem', { name: 'common.userProfile.contactUs' }))

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('common.api.actionFailed'))
  })

  it('renders contact us with upgrade badge for Cloud sandbox plan without dedicated support', async () => {
    const user = userEvent.setup()
    plan = 'sandbox'

    renderSupportMenu()

    expect(screen.queryByText('common.userProfile.emailSupport')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'billing.upgradeBtn.encourageShort' }),
    ).not.toBeInTheDocument()

    const upgradeItem = screen.getByRole('menuitem', {
      name: 'common.userProfile.contactUs billing.upgradeBtn.encourageShort',
    })
    await user.click(upgradeItem)

    await waitFor(() =>
      expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
    )
    expect(zendeskRuntime.open).not.toHaveBeenCalled()
  })

  it('keeps Zendesk contact us for Cloud sandbox plan with support email and Zendesk configured', async () => {
    const user = userEvent.setup()
    mockConfig.supportEmailAddress = 'support@example.com'
    plan = 'sandbox'

    renderSupportMenu()

    expect(screen.getByText('common.userProfile.contactUs')).toBeInTheDocument()
    expect(screen.queryByText('billing.upgradeBtn.encourageShort')).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'common.userProfile.contactUs' }))

    expect(zendeskRuntime.open).toHaveBeenCalledWith('CLOUD')
    expect(onPricingUrlUpdate).not.toHaveBeenCalled()
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
