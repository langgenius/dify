import type { AppNetworkAccessGroupBindingResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { NetworkAccessGroupResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createNetworkAccessGroupFixture,
  seedAppNetworkAccessGroup,
  seedNetworkAccessGroups,
} from '@/test/console/network-access'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { AccessControlEntry } from '..'

const mockSetPricing = vi.fn()
const mockSetSettingsDestination = vi.fn()
const accessControlTranslations = vi.hoisted(() => ({
  'operation.cancel': 'Cancel',
  'operation.close': 'Close',
  'operation.save': 'Save',
  'overview.apiInfo.title': 'Backend Service API',
  'overview.appInfo.title': 'Web App',
  'mcp.server.title': 'MCP Server',
  'settings.ipPolicies': 'IP Policies',
  'settings.ipPolicyAddEntry': 'Add',
  'settings.ipPolicyAllowlist': 'Allowlist',
  'settings.ipPolicyAllowlistHelp':
    'Single addresses (203.0.113.42) or CIDR ranges (10.0.0.0/8). IPv4 and IPv6 are both accepted.',
  'settings.ipPolicyCreate': 'Create',
  'settings.ipPolicyDialogDescription':
    'Specify which IP addresses or ranges can access your apps.',
  'settings.ipPolicyName': 'Name',
  'settings.ipPolicyNamePlaceholder': 'e.g. Internal Network',
  'settings.ipPolicyNewTitle': 'New IP Policy',
  'settings.ipPolicyRemoveEntry': 'Remove entry',
  'settings.trigger': 'Trigger',
  'studio.accessControl.addressCount': '{{count}} addresses',
  'studio.accessControl.applyTo': 'Apply to',
  'studio.accessControl.applyToHelp': 'Choose which access points to protect.',
  'studio.accessControl.applyToHelpSelected': 'Choose which access points this policy protects.',
  'studio.accessControl.createIpPolicy': 'Create an IP policy',
  'studio.accessControl.emptyPoliciesTitle': 'No IP policies in this workspace yet',
  'studio.accessControl.chipOff': 'Off',
  'studio.accessControl.chipOn': 'ON',
  'studio.accessControl.chipPartial': '{{n}} of {{m}}',
  'studio.accessControl.entryLabel': 'Access Control',
  'studio.accessControl.ipPolicy': 'IP Policy',
  'studio.accessControl.manageIpPolicies': 'Manage IP policies',
  'studio.accessControl.notEnabled': 'Not enabled',
  'studio.accessControl.paywallDescription': 'Restrict this app to IP addresses you trust.',
  'studio.accessControl.paywallTitle': 'Access Control',
  'studio.accessControl.policySummaryOne': 'Allows {{address}}',
  'studio.accessControl.previewAppName': 'Code Companion',
  'studio.accessControl.previewCaption':
    "This app is only available on your organization's network.",
  'studio.accessControl.proBadge': 'PRO',
  'studio.accessControl.selectPolicy': 'Select a policy',
  'studio.accessControl.tooltipOff': 'Not set up',
  'studio.accessControl.tooltipPro': 'Access control requires the Pro plan',
  'studio.accessControl.turnOn': 'Turn on Access Control',
  'studio.accessControl.restrictByIp': 'Restrict by IP address',
  'studio.accessControl.restrictedTo': 'Restricted to {{name}}',
  'studio.accessControl.excluded': 'Excluded',
  'studio.accessControl.protectingAll': 'Protecting all {{count}} access points in service.',
  'studio.accessControl.protectingPartial': 'Protecting {{n}} of {{m}} access points in service.',
  'studio.accessControl.policySummaryTwo': 'Allows {{first}} and {{second}}',
  'operation.edit': 'Edit',
  'studio.accessControl.turnOffTitle': 'Turn off access control?',
  'studio.accessControl.turnOffDescription': '{{points}} will be reachable from any IP.',
  'studio.accessControl.turnOffConfirm': 'Turn off',
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { appDetail: { id: string; mode: string } }) => unknown) =>
    selector({
      appDetail: {
        id: 'app-1',
        mode: 'chat',
      },
    }),
}))

vi.mock('nuqs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nuqs')>()
  return {
    ...actual,
    useQueryState: (name: string) => {
      if (name === 'pricing') return [null, mockSetPricing]
      return [null, mockSetSettingsDestination]
    },
  }
})

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock(accessControlTranslations)
})

const renderEntry = ({
  plan,
  deploymentEdition = 'CLOUD',
  groups = [],
  binding = null,
}: {
  plan?: CloudPlan
  deploymentEdition?: 'CLOUD' | 'COMMUNITY' | 'ENTERPRISE'
  groups?: NetworkAccessGroupResponse[]
  binding?: AppNetworkAccessGroupBindingResponse | null
} = {}) => {
  const queryClient = createConsoleQueryClient()
  const entitled = plan === 'professional' || plan === 'team'
  seedNetworkAccessGroups(queryClient, { entitled, groups })
  seedAppNetworkAccessGroup(queryClient, 'app-1', { entitled, binding })

  return renderWithConsoleQuery(<AccessControlEntry />, {
    queryClient,
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
  })

  it('does not render on community edition', () => {
    renderEntry({ deploymentEdition: 'COMMUNITY', plan: 'sandbox' })

    expect(screen.queryByRole('button', { name: /Access Control/ })).not.toBeInTheDocument()
  })

  it('does not render on enterprise edition', () => {
    renderEntry({ deploymentEdition: 'ENTERPRISE', plan: 'sandbox' })

    expect(screen.queryByRole('button', { name: /Access Control/ })).not.toBeInTheDocument()
  })

  it('shows a saved assignment on Cloud sandbox instead of hiding it behind the paywall', async () => {
    const user = userEvent.setup()
    renderEntry({
      plan: 'sandbox',
      groups: [createNetworkAccessGroupFixture()],
      binding: {
        id: 'binding-1',
        tenant_id: 'workspace-1',
        app_id: 'app-1',
        enabled: true,
        group_id: 'group-1',
        access_points: ['webapp', 'service_api', 'mcp'],
        version: 2,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    })

    expect(within(getChip()).getByText('3 of 4')).toBeInTheDocument()
    await user.click(getChip())
    expect(screen.getByText('Restricted to Internal Network')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn on Access Control' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
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

    expect(mockSetPricing).toHaveBeenCalledWith('open')
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
    expect(mockSetPricing).not.toHaveBeenCalled()
  })

  it('opens the first-time config popover for paid workspaces without a back control', async () => {
    const user = userEvent.setup()
    renderEntry({ plan: 'professional' })

    await user.click(getChip())

    expect(screen.getByText('No IP policies in this workspace yet')).toBeInTheDocument()
    expect(
      screen.queryByText(
        'A policy is the list of IP addresses allowed in. Create one, then come back to apply it here.',
      ),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Web App' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('switch', { name: 'Backend Service API' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('switch', { name: 'MCP Server' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('switch', { name: 'Trigger' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.queryByText('Not enabled')).not.toBeInTheDocument()
  })

  it('opens the new policy dialog from the empty-state create action', async () => {
    const user = userEvent.setup()
    renderEntry({ plan: 'professional' })

    await user.click(getChip())
    await user.click(screen.getByRole('button', { name: 'Create an IP policy' }))

    expect(screen.getByRole('heading', { name: 'New IP Policy' })).toBeInTheDocument()
    expect(mockSetSettingsDestination).not.toHaveBeenCalled()
  })

  it('returns to the empty-state config after canceling the new policy dialog', async () => {
    const user = userEvent.setup()
    renderEntry({ plan: 'professional' })

    await user.click(getChip())
    await user.click(screen.getByRole('button', { name: 'Create an IP policy' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'New IP Policy' })).not.toBeInTheDocument()
    })
    expect(screen.getByText('No IP policies in this workspace yet')).toBeInTheDocument()
    expect(mockSetSettingsDestination).not.toHaveBeenCalled()
  })

  it('posts a new policy from the empty-state dialog without opening Settings', async () => {
    const user = userEvent.setup()
    const created = createNetworkAccessGroupFixture({
      id: 'group-office',
      name: 'Office',
      allowed_cidrs: ['10.0.0.0/8'],
    })
    const posted: Array<{ method: string; url: string; body: unknown }> = []
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init)
      const bodyText =
        request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text()
      posted.push({
        method: request.method,
        url: request.url,
        body: bodyText ? JSON.parse(bodyText) : null,
      })
      return new Response(JSON.stringify({ group: created }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    })
    renderEntry({ plan: 'professional' })

    await user.click(getChip())
    await user.click(screen.getByRole('button', { name: 'Create an IP policy' }))
    await user.type(screen.getByPlaceholderText('e.g. Internal Network'), 'Office')
    await user.type(screen.getByPlaceholderText('10.0.0.0/8'), '10.0.0.0/8')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(posted).toContainEqual({
        method: 'POST',
        url: 'http://localhost:5001/console/api/workspaces/current/network-access-groups',
        body: {
          name: 'Office',
          description: '',
          allowed_cidrs: ['10.0.0.0/8'],
        },
      })
    })
    expect(mockSetSettingsDestination).not.toHaveBeenCalled()
  })

  it('sends paid users to Settings IP Policies from manage', async () => {
    const user = userEvent.setup()
    renderEntry({
      plan: 'professional',
      groups: [createNetworkAccessGroupFixture()],
    })

    await user.click(getChip())
    await user.click(screen.getByRole('button', { name: 'Manage IP policies' }))

    expect(mockSetSettingsDestination).toHaveBeenCalledWith('ip-policies')
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
    expect(mockSetPricing).not.toHaveBeenCalled()
  })

  it('shows the saved binding status for a paid workspace', async () => {
    const user = userEvent.setup()
    renderEntry({
      plan: 'professional',
      groups: [createNetworkAccessGroupFixture()],
      binding: {
        id: 'binding-1',
        tenant_id: 'workspace-1',
        app_id: 'app-1',
        enabled: true,
        group_id: 'group-1',
        access_points: ['webapp', 'service_api', 'mcp'],
        version: 2,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    })

    expect(within(getChip()).getByText('3 of 4')).toBeInTheDocument()
    await user.click(getChip())
    expect(screen.getByText('Restricted to Internal Network')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Restrict by IP address' })).toBeChecked()
  })

  it('keeps the saved chip state until a turned-off draft is saved', async () => {
    const user = userEvent.setup()
    renderEntry({
      plan: 'professional',
      groups: [createNetworkAccessGroupFixture()],
      binding: {
        id: 'binding-1',
        tenant_id: 'workspace-1',
        app_id: 'app-1',
        enabled: true,
        group_id: 'group-1',
        access_points: ['webapp', 'service_api', 'mcp'],
        version: 2,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    })

    await user.click(getChip())
    await user.click(screen.getByRole('switch', { name: 'Restrict by IP address' }))
    await user.click(screen.getByRole('button', { name: 'Turn off' }))

    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(within(getChip()).getByText('3 of 4')).toBeInTheDocument()
  })
})
