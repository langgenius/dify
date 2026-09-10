import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useModalContext } from '@/context/modal-context'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { AccessControlEntry } from '..'

const mockSetShowPricingModal = vi.fn()
const mockSetSettingsDestination = vi.fn()
const accessControlTranslations = vi.hoisted(() => ({
  'operation.cancel': 'Cancel',
  'operation.save': 'Save',
  'overview.apiInfo.title': 'Backend Service API',
  'overview.appInfo.title': 'Web App',
  'mcp.server.title': 'MCP Server',
  'settings.trigger': 'Trigger',
  'studio.accessControl.applyTo': 'Apply to',
  'studio.accessControl.applyToHelp': 'Choose which access points to protect.',
  'studio.accessControl.createIpPolicy': 'Create an IP policy',
  'studio.accessControl.emptyPoliciesDescription':
    'A policy is the list of IP addresses allowed in. Create one, then come back to apply it here.',
  'studio.accessControl.emptyPoliciesTitle': 'No IP policies in this workspace yet',
  'studio.accessControl.chipOff': 'Off',
  'studio.accessControl.chipOn': 'ON',
  'studio.accessControl.chipPartial': '{{n}} of {{m}}',
  'studio.accessControl.entryLabel': 'Access Control',
  'studio.accessControl.ipPolicy': 'IP Policy',
  'studio.accessControl.notEnabled': 'Not enabled',
  'studio.accessControl.paywallDescription': 'Restrict this app to IP addresses you trust.',
  'studio.accessControl.paywallTitle': 'Access Control',
  'studio.accessControl.previewAppName': 'Code Companion',
  'studio.accessControl.previewCaption':
    "This app is only available on your organization's network.",
  'studio.accessControl.proBadge': 'PRO',
  'studio.accessControl.tooltipOff': 'Not set up',
  'studio.accessControl.tooltipPro': 'Access control requires the Pro plan',
  'studio.accessControl.turnOn': 'Turn on Access Control',
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: vi.fn(),
  useModalContextSelector: vi.fn(),
}))

vi.mock('nuqs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nuqs')>()
  return { ...actual, useQueryState: () => [null, mockSetSettingsDestination] }
})

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

  it('renders a single chip with a non-interactive PRO badge for Cloud sandbox', () => {
    renderEntry({ plan: 'sandbox' })

    const chip = getChip()
    expect(chip).toBeInTheDocument()
    expect(within(chip).getByText('PRO')).toBeInTheDocument()
    expect(within(chip).queryByRole('button')).not.toBeInTheDocument()
  })

  it.each(['professional', 'team'] as const)(
    'renders the unpaid-config Off chip on Cloud %s',
    (plan) => {
      renderEntry({ plan })

      const chip = getChip()
      expect(chip).toBeInTheDocument()
      expect(within(chip).getByText('Off')).toBeInTheDocument()
      expect(within(chip).queryByText('PRO')).not.toBeInTheDocument()
    },
  )

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

  it('opens the first-time config popover for paid workspaces without a back control', async () => {
    const user = userEvent.setup()
    renderEntry({ plan: 'professional' })

    await user.click(getChip())

    expect(screen.getByText('No IP policies in this workspace yet')).toBeInTheDocument()
    expect(
      screen.getByText(
        'A policy is the list of IP addresses allowed in. Create one, then come back to apply it here.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Web App' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('switch', { name: 'Backend Service API' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('switch', { name: 'MCP Server' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('switch', { name: 'Trigger' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('Not enabled')).toBeInTheDocument()
  })

  it('sends paid users to Settings IP Policies from the empty-state exit', async () => {
    const user = userEvent.setup()
    renderEntry({ plan: 'professional' })

    await user.click(getChip())
    await user.click(screen.getByRole('button', { name: 'Create an IP policy' }))

    expect(mockSetSettingsDestination).toHaveBeenCalledWith('ip-policies')
    await waitFor(() => {
      expect(screen.queryByText('No IP policies in this workspace yet')).not.toBeInTheDocument()
    })
  })

  it('closes the first-time config on Cancel without opening settings', async () => {
    const user = userEvent.setup()
    renderEntry({ plan: 'professional' })

    await user.click(getChip())
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByText('No IP policies in this workspace yet')).not.toBeInTheDocument()
    })
    expect(mockSetSettingsDestination).not.toHaveBeenCalled()
    expect(mockSetShowPricingModal).not.toHaveBeenCalled()
  })
})
