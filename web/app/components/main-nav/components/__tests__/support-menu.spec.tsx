import type { Mock } from 'vitest'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { fireEvent, render, screen } from '@testing-library/react'
import { openZendeskWindow } from '@/app/components/base/zendesk/utils'
import { Plan } from '@/app/components/billing/type'
import { mailToSupport } from '@/app/components/header/utils/util'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import SupportMenu from '../support-menu'

const { mockConfig, mockOpenZendeskWindow, mockMailToSupport, mockSetShowPricingModal } =
  vi.hoisted(() => ({
    mockConfig: {
      isCloudEdition: true,
      supportEmailAddress: '',
      zendeskWidgetKey: 'zendesk-key',
    },
    mockOpenZendeskWindow: vi.fn(),
    mockMailToSupport: vi.fn(),
    mockSetShowPricingModal: vi.fn(),
  }))
const mockAppContextState = vi.hoisted(() => ({
  current: {
    langGeniusVersionInfo: { current_version: '1.0.0' },
    userProfile: { email: 'user@example.com' },
  },
}))

vi.mock('@/app/components/base/zendesk/utils', () => ({
  openZendeskWindow: mockOpenZendeskWindow,
}))

vi.mock('@/app/components/header/utils/util', () => ({
  mailToSupport: mockMailToSupport,
}))

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    get IS_CLOUD_EDITION() {
      return mockConfig.isCloudEdition
    },
    get SUPPORT_EMAIL_ADDRESS() {
      return mockConfig.supportEmailAddress
    },
    get ZENDESK_WIDGET_KEY() {
      return mockConfig.zendeskWidgetKey
    },
  }
})

vi.mock('@/context/account-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState.current)
})
vi.mock('@/context/workspace-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState.current)
})
vi.mock('@/context/permission-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState.current)
})
vi.mock('@/context/version-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState.current)
})
vi.mock('@/context/system-features-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState.current)
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } =
    await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateJotaiMock(importOriginal)
})

vi.mock('@/context/modal-context', () => ({
  useModalContext: vi.fn(),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
}))

describe('SupportMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfig.isCloudEdition = true
    mockConfig.supportEmailAddress = ''
    mockConfig.zendeskWidgetKey = 'zendesk-key'
    mockAppContextState.current = {
      langGeniusVersionInfo: { current_version: '1.0.0' },
      userProfile: { email: 'user@example.com' },
    }
    ;(useProviderContext as Mock).mockReturnValue({
      enableBilling: true,
      plan: { type: Plan.team },
    })
    ;(useModalContext as Mock).mockReturnValue({
      setShowPricingModal: mockSetShowPricingModal,
    })
    ;(mailToSupport as Mock).mockReturnValue('mailto:support@example.com')
  })

  const renderSupportMenu = (onContactUsClick = vi.fn()) => {
    return render(
      <DropdownMenu open={true} onOpenChange={() => {}}>
        <DropdownMenuTrigger>open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <SupportMenu onContactUsClick={onContactUsClick} />
        </DropdownMenuContent>
      </DropdownMenu>,
    )
  }

  it('renders contact us before community support entries when Zendesk is configured', () => {
    const onContactUsClick = vi.fn()
    renderSupportMenu(onContactUsClick)

    expect(screen.getByText('common.userProfile.contactUs')).toBeInTheDocument()
    expect(screen.getByText('common.userProfile.forum')).toBeInTheDocument()
    expect(screen.getByText('common.userProfile.community')).toBeInTheDocument()
    expect(
      screen
        .getByText('common.userProfile.contactUs')
        .compareDocumentPosition(screen.getByText('common.userProfile.forum')),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(screen.getByRole('menuitem', { name: 'common.userProfile.forum' })).toHaveClass(
      'mx-0',
      'px-3',
    )

    fireEvent.click(screen.getByRole('menuitem', { name: 'common.userProfile.contactUs' }))

    expect(openZendeskWindow).toHaveBeenCalled()
    expect(onContactUsClick).toHaveBeenCalled()
  })

  it('renders contact us with upgrade badge for Cloud sandbox plan without dedicated support', () => {
    ;(useProviderContext as Mock).mockReturnValue({
      enableBilling: true,
      plan: { type: Plan.sandbox },
    })

    const onContactUsClick = vi.fn()
    renderSupportMenu(onContactUsClick)

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
    expect(openZendeskWindow).not.toHaveBeenCalled()
    expect(onContactUsClick).toHaveBeenCalled()
  })

  it('hides upgrade contact for Cloud sandbox plan when billing is disabled', () => {
    ;(useProviderContext as Mock).mockReturnValue({
      enableBilling: false,
      plan: { type: Plan.sandbox },
    })

    renderSupportMenu()

    expect(screen.queryByText('common.userProfile.contactUs')).not.toBeInTheDocument()
    expect(screen.queryByText('billing.upgradeBtn.encourageShort')).not.toBeInTheDocument()
    expect(screen.queryByText('common.userProfile.emailSupport')).not.toBeInTheDocument()
    expect(screen.getByText('common.userProfile.forum')).toBeInTheDocument()
  })

  it('keeps Zendesk contact us for Cloud sandbox plan with support email and Zendesk configured', () => {
    mockConfig.supportEmailAddress = 'support@example.com'
    ;(useProviderContext as Mock).mockReturnValue({
      enableBilling: true,
      plan: { type: Plan.sandbox },
    })

    renderSupportMenu()

    expect(screen.getByText('common.userProfile.contactUs')).toBeInTheDocument()
    expect(screen.queryByText('billing.upgradeBtn.encourageShort')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'common.userProfile.contactUs' }))

    expect(openZendeskWindow).toHaveBeenCalled()
    expect(mockSetShowPricingModal).not.toHaveBeenCalled()
  })

  it('keeps email support for Cloud sandbox plan with support email and no Zendesk configured', () => {
    mockConfig.supportEmailAddress = 'support@example.com'
    mockConfig.zendeskWidgetKey = ''
    ;(useProviderContext as Mock).mockReturnValue({
      enableBilling: true,
      plan: { type: Plan.sandbox },
    })

    renderSupportMenu()

    expect(screen.queryByText('common.userProfile.contactUs')).not.toBeInTheDocument()
    expect(screen.getByText('common.userProfile.emailSupport')).toBeInTheDocument()
    expect(screen.queryByText('billing.upgradeBtn.encourageShort')).not.toBeInTheDocument()
    expect(mailToSupport).toHaveBeenCalledWith(
      'user@example.com',
      Plan.sandbox,
      '1.0.0',
      'support@example.com',
    )
  })

  it('hides dedicated support channels for non-Cloud sandbox plan without support email', () => {
    mockConfig.isCloudEdition = false
    ;(useProviderContext as Mock).mockReturnValue({
      enableBilling: true,
      plan: { type: Plan.sandbox },
    })

    renderSupportMenu()

    expect(screen.queryByText('common.userProfile.contactUs')).not.toBeInTheDocument()
    expect(screen.queryByText('common.userProfile.emailSupport')).not.toBeInTheDocument()
    expect(screen.getByText('common.userProfile.forum')).toBeInTheDocument()
  })

  it('renders email support when Zendesk is not configured for a dedicated support channel', () => {
    mockConfig.zendeskWidgetKey = ''

    renderSupportMenu()

    expect(screen.queryByText('common.userProfile.contactUs')).not.toBeInTheDocument()
    expect(screen.getByText('common.userProfile.emailSupport')).toBeInTheDocument()
    expect(mailToSupport).toHaveBeenCalledWith('user@example.com', Plan.team, '1.0.0', '')
    expect(
      screen.getByRole('menuitem', { name: 'common.userProfile.emailSupport' }),
    ).toHaveAttribute('href', 'mailto:support@example.com')
  })

  it('has correct forum and community links', () => {
    renderSupportMenu()

    const forumLink = screen.getByText('common.userProfile.forum').closest('a')
    const communityLink = screen.getByText('common.userProfile.community').closest('a')
    expect(forumLink).toHaveAttribute('href', 'https://forum.dify.ai/')
    expect(communityLink).toHaveAttribute('href', 'https://discord.gg/5AEfbxcd9k')
  })
})
