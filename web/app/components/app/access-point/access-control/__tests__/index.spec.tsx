import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useModalContext } from '@/context/modal-context'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { AccessControlEntry } from '..'

const mockSetShowPricingModal = vi.fn()
const accessControlTranslations = vi.hoisted(() => ({
  'studio.accessControl.entryLabel': 'Access Control',
  'studio.accessControl.paywallDescription': 'Restrict this app to IP addresses you trust.',
  'studio.accessControl.paywallTitle': 'Access Control',
  'studio.accessControl.previewAppName': 'Code Companion',
  'studio.accessControl.previewCaption':
    "This app is only available on your organization's network.",
  'studio.accessControl.proBadge': 'PRO',
  'studio.accessControl.turnOn': 'Turn on Access Control',
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: vi.fn(),
  useModalContextSelector: vi.fn(),
}))

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock(accessControlTranslations)
})

const renderEntry = ({
  plan,
  deploymentEdition = 'CLOUD',
}: {
  plan?: CloudPlan
  deploymentEdition?: 'CLOUD' | 'COMMUNITY' | 'ENTERPRISE'
} = {}) => {
  return renderWithConsoleQuery(<AccessControlEntry />, {
    systemFeatures: { deployment_edition: deploymentEdition },
    features: plan
      ? {
          billing: {
            subscription: { interval: 'month', plan },
          },
        }
      : undefined,
  })
}

const getChip = () => screen.getByRole('button', { name: /Access Control/ })

describe('AccessControlEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useModalContext).mockReturnValue({
      hasBlockingModalOpen: false,
      setShowModerationSettingModal: vi.fn(),
      setShowExternalDataToolModal: vi.fn(),
      setShowPricingModal: mockSetShowPricingModal,
      setShowAnnotationFullModal: vi.fn(),
      setShowModelModal: vi.fn(),
      setShowExternalKnowledgeAPIModal: vi.fn(),
      setShowOpeningModal: vi.fn(),
      setShowUpdatePluginModal: vi.fn(),
    })
  })

  it('does not render on community edition', () => {
    renderEntry({ deploymentEdition: 'COMMUNITY', plan: 'sandbox' })

    expect(screen.queryByRole('button', { name: /Access Control/ })).not.toBeInTheDocument()
  })

  it('does not render on enterprise edition', () => {
    renderEntry({ deploymentEdition: 'ENTERPRISE', plan: 'sandbox' })

    expect(screen.queryByRole('button', { name: /Access Control/ })).not.toBeInTheDocument()
  })

  it.each(['professional', 'team'] as const)('does not render on Cloud %s', (plan) => {
    renderEntry({ plan })

    expect(screen.queryByRole('button', { name: /Access Control/ })).not.toBeInTheDocument()
  })

  it('renders a single chip with a non-interactive PRO badge for Cloud sandbox', () => {
    renderEntry({ plan: 'sandbox' })

    const chip = getChip()
    expect(chip).toBeInTheDocument()
    expect(within(chip).getByText('PRO')).toBeInTheDocument()
    expect(within(chip).queryByRole('button')).not.toBeInTheDocument()
  })

  it('opens the paywall popover from the chip and sends the user to pricing', async () => {
    const user = userEvent.setup()
    renderEntry({ plan: 'sandbox' })

    await user.click(getChip())

    expect(screen.getByText('Restrict this app to IP addresses you trust.')).toBeInTheDocument()
    expect(
      screen.getByText("This app is only available on your organization's network."),
    ).toBeInTheDocument()
    expect(screen.getAllByText('PRO')).toHaveLength(2)

    const turnOn = screen.getByRole('button', { name: 'Turn on Access Control' })
    expect(turnOn).not.toHaveTextContent('PRO')
    await user.click(turnOn)

    expect(mockSetShowPricingModal).toHaveBeenCalledTimes(1)
  })

  it('closes the paywall on Escape without side effects', async () => {
    const user = userEvent.setup()
    renderEntry({ plan: 'sandbox' })

    await user.click(getChip())
    expect(screen.getByText('Restrict this app to IP addresses you trust.')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(
        screen.queryByText('Restrict this app to IP addresses you trust.'),
      ).not.toBeInTheDocument()
    })
    expect(mockSetShowPricingModal).not.toHaveBeenCalled()
  })
})
