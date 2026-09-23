import type {
  AppNetworkAccessGroupBindingResponse,
  AppNetworkAccessGroupResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type {
  GetWorkspacesCurrentSummaryResponse,
  NetworkAccessGroupResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
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
  'operation.back': 'Back',
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
  'operation.edit': 'Edit',
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
  const { default: deploymentTranslations } = await import('@/i18n/locales/en-US/deployments.json')
  const { default: commonTranslations } = await import('@/i18n/locales/en-US/common.json')
  return createReactI18nextMock({
    ...commonTranslations,
    ...accessControlTranslations,
    ...deploymentTranslations,
  })
})

const renderEntry = ({
  plan,
  deploymentEdition = 'CLOUD',
  groups = [],
  binding = null,
  availableAccessPoints = ['webapp', 'service_api', 'mcp'],
  role = 'owner',
  canEditBinding = true,
  isPublished = false,
}: {
  plan?: CloudPlan
  deploymentEdition?: 'CLOUD' | 'COMMUNITY' | 'ENTERPRISE'
  groups?: NetworkAccessGroupResponse[]
  binding?: AppNetworkAccessGroupBindingResponse | null
  availableAccessPoints?: AppNetworkAccessGroupResponse['available_access_points']
  role?: GetWorkspacesCurrentSummaryResponse['role']
  canEditBinding?: boolean
  isPublished?: boolean
} = {}) => {
  const queryClient = createConsoleQueryClient()
  const entitled = plan === 'professional' || plan === 'team'
  seedNetworkAccessGroups(queryClient, { entitled, groups })
  seedAppNetworkAccessGroup(queryClient, 'app-1', {
    entitled,
    binding,
    available_access_points: availableAccessPoints,
  })

  return renderWithConsoleQuery(
    <AccessControlEntry
      appId="app-1"
      appIcon={{}}
      isPublished={isPublished}
      canEditBinding={canEditBinding}
    />,
    {
      queryClient,
      currentWorkspace: { role },
      systemFeatures: { deployment_edition: deploymentEdition },
      features: plan
        ? {
            billing: {
              subscription: { interval: 'month', plan },
            },
          }
        : undefined,
    },
  )
}

const metadataResponse = (request: Request) => {
  if (request.url.endsWith('/check-current-ip'))
    return Response.json({ allowed: true, client_ip: '203.0.113.42', policy_version: 1 })
  if (request.url.endsWith('/network-access-groups/current-ip'))
    return Response.json({ client_ip: '203.0.113.42' })
}

beforeEach(() => {
  const fallback = vi.mocked(globalThis.fetch).getMockImplementation()!
  vi.mocked(globalThis.fetch).mockImplementation(
    async (input, init) => metadataResponse(new Request(input, init)) ?? fallback(input, init),
  )
})

const getChip = () => screen.getByRole('button', { name: /Access Control/ })

const createBinding = (
  overrides: Partial<AppNetworkAccessGroupBindingResponse> = {},
): AppNetworkAccessGroupBindingResponse => ({
  id: 'binding-1',
  tenant_id: 'workspace-1',
  app_id: 'app-1',
  enabled: true,
  group_id: 'group-1',
  access_points: ['webapp', 'service_api', 'mcp'],
  version: 2,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
})

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

  it.each([
    { enabled: true, accessPoints: ['webapp', 'service_api', 'mcp'], coverage: '3 of 3' },
    { enabled: true, accessPoints: ['webapp'], coverage: '1 of 3' },
    { enabled: false, accessPoints: ['webapp', 'service_api', 'mcp'], coverage: '3 of 3' },
  ] as const)(
    'shows PRO and the saved resume configuration on Cloud sandbox (%j)',
    async ({ enabled, accessPoints, coverage }) => {
      const user = userEvent.setup()
      renderEntry({
        plan: 'sandbox',
        groups: [createNetworkAccessGroupFixture()],
        binding: {
          id: 'binding-1',
          tenant_id: 'workspace-1',
          app_id: 'app-1',
          enabled,
          group_id: 'group-1',
          access_points: [...accessPoints],
          version: 2,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      })

      expect(within(getChip()).getByText('PRO')).toBeInTheDocument()
      await user.hover(getChip())
      expect(
        await screen.findByText('No longer protected. Available on Professional and Team plans.'),
      ).toBeInTheDocument()
      await user.unhover(getChip())
      await user.click(getChip())
      expect(screen.getByText('This app is no longer protected')).toBeInTheDocument()
      expect(
        screen.getByText('Access control is available on Professional and Team plans.'),
      ).toBeInTheDocument()
      expect(screen.getByText('Ready to resume')).toBeInTheDocument()
      expect(screen.getByText('Internal Network')).toBeInTheDocument()
      expect(screen.getByText(`Protects ${coverage} access points`)).toBeInTheDocument()
      expect(screen.queryByText('Restricted to Internal Network')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
      expect(
        screen.queryByRole('switch', { name: 'Restrict by IP address' }),
      ).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Turn on Access Control' }))
      expect(mockSetPricing).toHaveBeenCalledWith('open')
    },
  )

  it('shows the plan requirement for an unconfigured Cloud sandbox app', async () => {
    const user = userEvent.setup()
    renderEntry({ plan: 'sandbox' })

    const chip = getChip()
    expect(chip).toBeInTheDocument()
    expect(within(chip).getByText('PRO')).toBeInTheDocument()
    expect(within(chip).queryByRole('button')).not.toBeInTheDocument()
    await user.hover(chip)
    expect(
      await screen.findByText('Access control is available on Professional and Team plans.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/No longer protected/)).not.toBeInTheDocument()
  })

  it.each([
    { accessPoints: ['webapp', 'service_api', 'mcp'], protectedCount: 3 },
    { accessPoints: ['webapp', 'service_api', 'mcp', 'trigger'], protectedCount: 4 },
  ] as const)(
    'shows $protectedCount of 4 protected access points on hover',
    async ({ accessPoints, protectedCount }) => {
      const user = userEvent.setup()
      renderEntry({
        plan: 'professional',
        groups: [createNetworkAccessGroupFixture()],
        binding: createBinding({ access_points: [...accessPoints] }),
        availableAccessPoints: ['webapp', 'service_api', 'mcp', 'trigger'],
      })

      await user.hover(getChip())
      expect(
        await screen.findByText(`${protectedCount} of 4 access points are protected`),
      ).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    },
  )

  it.each(['professional', 'team'] as const)(
    'renders the unpaid-config Off chip on Cloud %s',
    async (plan) => {
      const user = userEvent.setup()
      renderEntry({ plan })

      const chip = getChip()
      expect(chip).toBeInTheDocument()
      expect(within(chip).getByText('Off')).toBeInTheDocument()
      expect(within(chip).queryByText('PRO')).not.toBeInTheDocument()
      await user.hover(chip)
      expect(await screen.findByText('Not configured')).toBeInTheDocument()
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
    expect(screen.getByRole('switch', { name: 'Web App' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('switch', { name: 'Backend Service API' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('switch', { name: 'MCP Server' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.queryByRole('switch', { name: 'Trigger' })).not.toBeInTheDocument()
    expect(screen.queryByText('Not enabled')).not.toBeInTheDocument()
  })

  it('opens the new policy dialog from the empty-state create action', async () => {
    const user = userEvent.setup()
    renderEntry({ plan: 'professional' })

    await user.click(getChip())
    await user.click(screen.getByRole('button', { name: 'Add IP Policy' }))

    expect(screen.getByRole('heading', { name: 'New IP Policy' })).toBeInTheDocument()
    expect(mockSetSettingsDestination).not.toHaveBeenCalled()
  })

  it('returns to the empty-state config after canceling the new policy dialog', async () => {
    const user = userEvent.setup()
    renderEntry({ plan: 'professional' })

    await user.click(getChip())
    await user.click(screen.getByRole('button', { name: 'Add IP Policy' }))
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
      const metadata = metadataResponse(request)
      if (metadata) return metadata
      const bodyText =
        request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text()
      posted.push({
        method: request.method,
        url: request.url,
        body: bodyText ? JSON.parse(bodyText) : null,
      })
      if (request.method === 'GET') {
        return request.url.endsWith('/network-access-groups')
          ? Response.json({ tenant_id: 'workspace-1', entitled: true, groups: [created] })
          : Response.json({
              tenant_id: 'workspace-1',
              app_id: 'app-1',
              entitled: true,
              binding: null,
              available_access_points: ['webapp', 'service_api', 'mcp'],
              effective_enabled: false,
            })
      }
      return Response.json({ group: created }, { status: 201 })
    })
    renderEntry({ plan: 'professional' })

    await user.click(getChip())
    await user.click(screen.getByRole('button', { name: 'Add IP Policy' }))
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
    expect(await screen.findByRole('option', { name: /Office/ })).toHaveAttribute(
      'aria-selected',
      'false',
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Web App' })).toHaveAttribute('aria-disabled', 'true')
    expect(posted.filter((request) => request.method === 'PUT')).toHaveLength(0)
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

    expect(within(getChip()).getByText('On')).toBeInTheDocument()
    await user.click(getChip())
    expect(screen.getByText('Restricted to Internal Network')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Restrict by IP address' })).toBeChecked()
  })

  it('discards an unsaved first-time draft on Cancel', async () => {
    const user = userEvent.setup()
    renderEntry({ plan: 'professional', groups: [createNetworkAccessGroupFixture()] })

    await user.click(getChip())
    await user.click(screen.getByRole('option', { name: /Internal Network/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    await user.click(screen.getByRole('switch', { name: 'Web App' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })

    await user.click(getChip())
    expect(screen.getByRole('switch', { name: 'Web App' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('restores an unsaved first-time draft after Escape', async () => {
    const user = userEvent.setup()
    renderEntry({ plan: 'professional', groups: [createNetworkAccessGroupFixture()] })

    await user.click(getChip())
    await user.click(screen.getByRole('option', { name: /Internal Network/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    await user.click(screen.getByRole('switch', { name: 'Web App' }))
    expect(screen.getByRole('switch', { name: 'Web App' })).not.toBeChecked()

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })

    await user.click(getChip())
    expect(screen.getByRole('combobox', { name: 'IP Policy' })).toHaveTextContent(
      'Internal Network',
    )
    expect(screen.getByRole('switch', { name: 'Web App' })).not.toBeChecked()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
  })

  it('restores an unsaved edit after Escape and keeps the saved chip', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('switch', { name: 'MCP Server' }))
    expect(screen.getByRole('switch', { name: 'MCP Server' })).not.toBeChecked()

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })
    expect(within(getChip()).getByText('On')).toBeInTheDocument()

    await user.click(getChip())
    expect(screen.queryByText('Restricted to Internal Network')).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'MCP Server' })).not.toBeChecked()
    expect(screen.queryByRole('switch', { name: 'Trigger' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    expect(within(getChip()).getByText('On')).toBeInTheDocument()
  })

  it('discards an unsaved edit on Cancel', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('switch', { name: 'MCP Server' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByText('Restricted to Internal Network')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByText('Restricted to Internal Network')).not.toBeInTheDocument()
    })

    await user.click(getChip())
    expect(screen.getByText('Restricted to Internal Network')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it.each([false, true])(
    'closes and restores a draft with the Close button (configured: %s)',
    async (configured) => {
      const user = userEvent.setup()
      renderEntry({
        plan: 'professional',
        groups: [createNetworkAccessGroupFixture()],
        binding: configured ? createBinding() : null,
      })

      await user.click(getChip())
      if (configured) await user.click(screen.getByRole('button', { name: 'Edit' }))
      else await user.click(screen.getByRole('option', { name: /Internal Network/ }))
      await user.click(screen.getByRole('switch', { name: 'MCP Server' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())

      await user.click(screen.getByRole('button', { name: 'Close' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(within(getChip()).getByText(configured ? 'On' : 'Off')).toBeInTheDocument()

      await user.click(getChip())
      expect(screen.getByRole('combobox', { name: 'IP Policy' })).toHaveTextContent(
        'Internal Network',
      )
      expect(screen.getByRole('switch', { name: 'MCP Server' })).not.toBeChecked()
      await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    },
  )

  it('closes a clean edit and reopens the saved preview with the Close button', async () => {
    const user = userEvent.setup()
    renderEntry({
      plan: 'professional',
      groups: [createNetworkAccessGroupFixture()],
      binding: createBinding(),
    })

    await user.click(getChip())
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(getChip())
    expect(screen.getByText('Restricted to Internal Network')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('discards an unsaved edit on Back', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('switch', { name: 'MCP Server' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(screen.getByText('Restricted to Internal Network')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByText('Restricted to Internal Network')).not.toBeInTheDocument()
    })

    await user.click(getChip())
    expect(screen.getByText('Restricted to Internal Network')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('does not restore a clean edit session after Escape', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })

    await user.click(getChip())
    expect(screen.getByText('Restricted to Internal Network')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  })
})

const capabilityCases = [
  {
    name: 'workflow',
    points: ['webapp', 'service_api', 'mcp', 'trigger'],
    labels: ['Web App', 'Backend Service API', 'MCP Server', 'Trigger'],
  },
  {
    name: 'legacy and chatflow',
    points: ['webapp', 'service_api', 'mcp'],
    labels: ['Web App', 'Backend Service API', 'MCP Server'],
  },
  { name: 'agent', points: ['webapp', 'service_api'], labels: ['Web App', 'Backend Service API'] },
] satisfies {
  name: string
  points: AppNetworkAccessGroupResponse['available_access_points']
  labels: string[]
}[]

describe('supported access points and binding permission', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(capabilityCases)(
    'shows and saves exactly the $name capabilities',
    async ({ points, labels }) => {
      const user = userEvent.setup()
      const requests: Record<string, unknown>[] = []
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const request = new Request(input, init)
        const metadata = metadataResponse(request)
        if (metadata) return metadata
        if (request.method === 'PUT') {
          const payload = await request.json()
          requests.push(payload)
          return Response.json({
            binding: createBinding({ ...payload, version: 1 }),
            available_access_points: points,
            effective_enabled: true,
          })
        }
        return Response.json({
          tenant_id: 'workspace-1',
          app_id: 'app-1',
          entitled: true,
          binding: createBinding({ access_points: points }),
          available_access_points: points,
          effective_enabled: true,
        })
      })
      try {
        renderEntry({
          plan: 'professional',
          availableAccessPoints: points,
          groups: [createNetworkAccessGroupFixture()],
        })
        await user.click(getChip())
        expect(screen.getAllByRole('switch')).toHaveLength(labels.length)
        labels.forEach((label) => expect(screen.getByRole('switch', { name: label })).toBeChecked())
        await user.click(screen.getByRole('option', { name: /Internal Network/ }))
        await user.click(screen.getByRole('button', { name: 'Save' }))
        await waitFor(() =>
          expect(requests).toEqual([
            { enabled: true, group_id: 'group-1', access_points: points, expected_version: 0 },
          ]),
        )
      } finally {
        fetchSpy.mockRestore()
      }
    },
  )

  it.each(capabilityCases)(
    'shows full $name coverage in saved status',
    async ({ points, labels }) => {
      const user = userEvent.setup()
      renderEntry({
        plan: 'professional',
        availableAccessPoints: points,
        groups: [createNetworkAccessGroupFixture()],
        binding: createBinding({ access_points: points }),
      })
      expect(within(getChip()).getByText('On')).toBeInTheDocument()
      await user.click(getChip())
      expect(
        screen.getByText(`Protecting all ${points.length} access points in service.`),
      ).toBeInTheDocument()
      labels.forEach((label) => expect(screen.getByText(label)).toBeInTheDocument())
      if (!points.includes('trigger')) expect(screen.queryByText('Trigger')).not.toBeInTheDocument()
      if (!points.includes('mcp')) expect(screen.queryByText('MCP Server')).not.toBeInTheDocument()
    },
  )

  it.each(capabilityCases)(
    'uses $name capabilities in the downgrade summary',
    async ({ points }) => {
      const user = userEvent.setup()
      renderEntry({
        plan: 'sandbox',
        availableAccessPoints: points,
        groups: [createNetworkAccessGroupFixture()],
        binding: createBinding({ access_points: points }),
      })
      await user.click(getChip())
      expect(
        screen.getByText(`Protects ${points.length} of ${points.length} access points`),
      ).toBeInTheDocument()
    },
  )

  it('asks editors to contact an owner or admin when no policies exist', async () => {
    const user = userEvent.setup()
    renderEntry({ plan: 'professional', role: 'editor' })
    await user.click(getChip())

    expect(screen.getByText('Ask a workspace owner or admin to create one.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add IP Policy' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /(?:Manage|View) IP policies/ }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Web App' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('lets editors select and save an existing policy without allowing policy creation', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input, init) =>
        metadataResponse(new Request(input, init)) ??
        Response.json({
          binding: createBinding(),
          available_access_points: ['webapp', 'service_api', 'mcp'],
          effective_enabled: true,
        }),
    )
    try {
      renderEntry({
        plan: 'professional',
        role: 'editor',
        groups: [createNetworkAccessGroupFixture()],
      })
      await user.click(getChip())
      expect(screen.queryByRole('button', { name: 'Add IP Policy' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'View IP policies' }))
      expect(mockSetSettingsDestination).toHaveBeenCalledWith('ip-policies')
      await user.click(getChip())
      await user.click(screen.getByRole('option', { name: /Internal Network/ }))
      await user.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() =>
        expect(
          fetchSpy.mock.calls.some(([input, init]) => new Request(input, init).method === 'PUT'),
        ).toBe(true),
      )
      const [input, init] = fetchSpy.mock.calls.find(
        ([input, init]) => new Request(input, init).method === 'PUT',
      )!
      expect(new Request(input, init).method).toBe('PUT')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it.each(['owner', 'admin', 'editor'] as const)(
    'lets %s pause and resume while preserving scopes and versions',
    async (role) => {
      const user = userEvent.setup()
      const availableAccessPoints = ['webapp', 'service_api', 'mcp'] as const
      let binding = createBinding({ access_points: ['webapp', 'mcp'] })
      const payloads: unknown[] = []
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const request = new Request(input, init)
        const metadata = metadataResponse(request)
        if (metadata) return metadata
        if (request.url.endsWith('/workspaces/current/network-access-groups'))
          return Response.json({
            tenant_id: 'workspace-1',
            entitled: true,
            groups: [createNetworkAccessGroupFixture()],
          })
        if (request.method === 'PUT') {
          const payload = await request.json()
          payloads.push(payload)
          binding = createBinding({ ...payload, version: binding.version + 1 })
          return Response.json({
            binding,
            available_access_points: availableAccessPoints,
            effective_enabled: binding.enabled,
          })
        }
        return Response.json({
          tenant_id: 'workspace-1',
          app_id: 'app-1',
          entitled: true,
          binding,
          available_access_points: availableAccessPoints,
          effective_enabled: binding.enabled,
        })
      })
      try {
        renderEntry({
          plan: 'professional',
          role,
          groups: [createNetworkAccessGroupFixture()],
          binding,
        })
        await user.click(getChip())
        await user.click(screen.getByRole('switch', { name: 'Restrict by IP address' }))
        expect(
          screen.getByRole('alertdialog', { name: 'Turn off IP access control?' }),
        ).toHaveAccessibleDescription(
          'All access points will be reachable from any IP address. Your configuration will be kept.',
        )
        expect(payloads).toHaveLength(0)
        await user.click(screen.getByRole('button', { name: 'Turn off' }))
        await waitFor(() =>
          expect(payloads).toEqual([
            {
              enabled: false,
              group_id: 'group-1',
              access_points: ['webapp', 'mcp'],
              expected_version: 2,
            },
          ]),
        )
        await waitFor(() =>
          expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument(),
        )
        expect(screen.getByRole('switch', { name: 'Restrict by IP address' })).not.toBeChecked()
        expect(
          screen.getByText('Paused — Internal Network is configured but not enforcing'),
        ).toBeInTheDocument()
        expect(within(getChip()).getByText('Paused')).toBeInTheDocument()
        expect(screen.queryByText(/Protecting/)).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
        await user.click(screen.getByRole('switch', { name: 'Restrict by IP address' }))
        await waitFor(() => expect(payloads).toHaveLength(2))
        expect(payloads[1]).toEqual({
          enabled: true,
          group_id: 'group-1',
          access_points: ['webapp', 'mcp'],
          expected_version: 3,
        })
        await waitFor(() => expect(within(getChip()).getByText('2 of 3')).toBeInTheDocument())
        expect(screen.getByRole('switch', { name: 'Restrict by IP address' })).toBeChecked()
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
        await waitFor(() =>
          expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument(),
        )
      } finally {
        fetchSpy.mockRestore()
      }
    },
  )

  it('shows a paid read-only binding without a downgrade or editing controls', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      renderEntry({
        plan: 'professional',
        canEditBinding: false,
        groups: [createNetworkAccessGroupFixture()],
        binding: createBinding(),
      })
      await user.click(getChip())
      expect(screen.getByText('Restricted to Internal Network')).toBeInTheDocument()
      expect(screen.getByRole('switch', { name: 'Restrict by IP address' })).toHaveAttribute(
        'aria-disabled',
        'true',
      )
      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
      expect(screen.queryByText('This app is no longer protected')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Turn on Access Control' }),
      ).not.toBeInTheDocument()
      await user.click(screen.getByRole('switch', { name: 'Restrict by IP address' }))
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('discards unsaved policy and scope edits when binding permission is revoked', async () => {
    const user = userEvent.setup()
    const rendered = renderEntry({
      plan: 'professional',
      groups: [
        createNetworkAccessGroupFixture(),
        createNetworkAccessGroupFixture({ id: 'group-2', name: 'Office' }),
      ],
      binding: createBinding(),
    })
    await user.click(getChip())
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('combobox', { name: 'IP Policy' }))
    await user.click(screen.getByRole('option', { name: /Office/ }))
    await user.click(screen.getByRole('switch', { name: 'MCP Server' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())

    rendered.rerender(
      <AccessControlEntry appId="app-1" appIcon={{}} isPublished={false} canEditBinding={false} />,
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(getChip())
    expect(screen.getByText('Restricted to Internal Network')).toBeInTheDocument()
    expect(screen.getByText('Protecting all 3 access points in service.')).toBeInTheDocument()
    expect(screen.queryByText('Office')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Restrict by IP address' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    rendered.rerender(
      <AccessControlEntry appId="app-1" appIcon={{}} isPublished={false} canEditBinding />,
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(getChip())
    expect(screen.getByText('Restricted to Internal Network')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('combobox', { name: 'IP Policy' })).toHaveTextContent(
      'Internal Network',
    )
    expect(screen.getByRole('switch', { name: 'MCP Server' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('closes an outstanding pause confirmation when binding permission is revoked', async () => {
    const user = userEvent.setup()
    const rendered = renderEntry({
      plan: 'professional',
      groups: [createNetworkAccessGroupFixture()],
      binding: createBinding(),
    })
    await user.click(getChip())
    await user.click(screen.getByRole('switch', { name: 'Restrict by IP address' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    rendered.rerender(
      <AccessControlEntry appId="app-1" appIcon={{}} isPublished={false} canEditBinding={false} />,
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await user.click(getChip())
    expect(screen.getByRole('switch', { name: 'Restrict by IP address' })).toBeChecked()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()

    rendered.rerender(
      <AccessControlEntry appId="app-1" appIcon={{}} isPublished={false} canEditBinding />,
    )
    await user.click(getChip())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Restrict by IP address' })).toBeChecked()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('keeps first-time binding controls read-only when app edits are forbidden', async () => {
    const user = userEvent.setup()
    renderEntry({
      plan: 'professional',
      canEditBinding: false,
      groups: [createNetworkAccessGroupFixture()],
    })
    await user.click(getChip())
    expect(screen.getByRole('option', { name: /Internal Network/ })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Web App' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it.each(['normal', 'dataset_operator'] as const)('hides the entry from workspace %s', (role) => {
    renderEntry({ plan: 'professional', role })
    expect(screen.queryByRole('button', { name: /Access Control/ })).not.toBeInTheDocument()
  })

  it('does not create an editable fallback when available access points are empty', () => {
    renderEntry({ plan: 'professional', availableAccessPoints: [] })
    expect(screen.queryByRole('button', { name: /Access Control/ })).not.toBeInTheDocument()
  })

  it('discards the previous app draft when the App ID changes', async () => {
    const user = userEvent.setup()
    const rendered = renderEntry({
      plan: 'professional',
      groups: [createNetworkAccessGroupFixture()],
    })
    seedAppNetworkAccessGroup(rendered.queryClient, 'app-2', {
      available_access_points: ['webapp', 'service_api'],
    })
    await user.click(getChip())
    await user.click(screen.getByRole('option', { name: /Internal Network/ }))
    await user.click(screen.getByRole('switch', { name: 'Web App' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    rendered.rerender(
      <AccessControlEntry appId="app-2" appIcon={{}} isPublished={false} canEditBinding />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(getChip())
    expect(screen.getByRole('switch', { name: 'Web App' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.queryByRole('switch', { name: 'MCP Server' })).not.toBeInTheDocument()
  })

  it.each([
    {
      name: 'failed binding query',
      response: () => Response.json({ message: 'Service unavailable' }, { status: 503 }),
      status: 'error',
    },
    {
      name: 'missing capability field',
      response: () =>
        Response.json({
          tenant_id: 'workspace-1',
          app_id: 'app-1',
          entitled: true,
          binding: null,
          effective_enabled: false,
        }),
      status: 'success',
    },
  ])('does not enable editing after $name', async ({ response, status }) => {
    const queryClient = createConsoleQueryClient()
    seedNetworkAccessGroups(queryClient, { entitled: true })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response())
    try {
      renderWithConsoleQuery(
        <AccessControlEntry appId="app-1" appIcon={{}} isPublished={false} canEditBinding />,
        {
          queryClient,
          systemFeatures: { deployment_edition: 'CLOUD' },
        },
      )
      await waitFor(() =>
        expect(
          queryClient.getQueryState(
            consoleQuery.apps.byAppId.networkAccessGroup.get.queryKey({
              input: { params: { app_id: 'app-1' } },
            }),
          )?.status,
        ).toBe(status),
      )
      expect(screen.queryByRole('button', { name: /Access Control/ })).not.toBeInTheDocument()
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

const setupBindingServer = (initialBinding: AppNetworkAccessGroupBindingResponse | null = null) => {
  const state = {
    binding: initialBinding,
    groups: [createNetworkAccessGroupFixture()],
    check: { allowed: false, client_ip: '203.0.113.42', policy_version: 1 },
    checkStatus: 200,
    checks: 0,
    writes: [] as Record<string, unknown>[],
    put: undefined as (() => Promise<Response>) | undefined,
    createStatus: 201,
  }
  vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
    const request = new Request(input, init)
    if (request.url.endsWith('/check-current-ip')) {
      state.checks += 1
      return Response.json(
        state.checkStatus === 200 ? state.check : { message: 'IP unavailable' },
        { status: state.checkStatus },
      )
    }
    if (request.url.endsWith('/current-ip'))
      return Response.json({ client_ip: state.check.client_ip })
    if (request.method === 'PUT') {
      const payload = await request.json()
      state.writes.push(payload)
      if (state.put) return state.put()
      state.binding = createBinding({ ...payload, version: (state.binding?.version ?? 0) + 1 })
      return Response.json({ binding: state.binding, effective_enabled: state.binding.enabled })
    }
    if (request.url.endsWith('/network-access-groups')) {
      if (request.method === 'POST') {
        if (state.createStatus !== 201)
          return Response.json({ message: 'Creation failed' }, { status: state.createStatus })
        const group = createNetworkAccessGroupFixture({
          ...(await request.json()),
          id: 'new-policy',
        })
        state.groups.push(group)
        return Response.json({ group }, { status: 201 })
      }
      return Response.json({ tenant_id: 'workspace-1', entitled: true, groups: state.groups })
    }
    return Response.json({
      tenant_id: 'workspace-1',
      app_id: 'app-1',
      entitled: true,
      binding: state.binding,
      effective_enabled: state.binding?.enabled ?? false,
      available_access_points: ['webapp', 'service_api', 'mcp'],
    })
  })
  return state
}

const openSelectedConfig = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(getChip())
  await user.click(screen.getByRole('option', { name: /Internal Network/ }))
}

const lockoutWarning = "Your IP (203.0.113.42) isn't in this policy. You may lose access."

describe('trusted IP checks before saving', () => {
  it('applies policy and scope edits to a live app only after Save', async () => {
    const user = userEvent.setup()
    const server = setupBindingServer(createBinding())
    server.groups.push(createNetworkAccessGroupFixture({ id: 'group-2', name: 'Office' }))
    server.check.allowed = true
    renderEntry({
      plan: 'professional',
      groups: server.groups,
      binding: server.binding,
      isPublished: true,
    })

    await user.click(getChip())
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.queryByRole('switch', { name: 'Restrict by IP address' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'IP Policy' }))
    await user.click(screen.getByRole('option', { name: /Office/ }))
    await user.click(screen.getByRole('switch', { name: 'MCP Server' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())

    expect(server.writes).toHaveLength(0)
    expect(server.binding).toMatchObject({
      enabled: true,
      group_id: 'group-1',
      access_points: ['webapp', 'service_api', 'mcp'],
    })
    expect(within(getChip()).getByText('On')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(server.writes).toEqual([
        {
          enabled: true,
          group_id: 'group-2',
          access_points: ['webapp', 'service_api'],
          expected_version: 2,
        },
      ]),
    )
    expect(await screen.findByText('Restricted to Office')).toBeInTheDocument()
  })

  it.each([true, false])(
    'enables a paused policy after saving edits with a fresh IP check (allowed: %s)',
    async (allowed) => {
      const user = userEvent.setup()
      const server = setupBindingServer(createBinding({ enabled: false }))
      server.check.allowed = allowed
      renderEntry({
        plan: 'professional',
        groups: server.groups,
        binding: server.binding,
        isPublished: true,
      })
      await user.click(getChip())
      await user.click(screen.getByRole('button', { name: 'Edit' }))
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      await user.click(screen.getByRole('switch', { name: 'MCP Server' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
      expect(within(getChip()).getByText('Paused')).toBeInTheDocument()
      expect(server.writes).toHaveLength(0)
      const checksBeforeSave = server.checks
      await user.click(screen.getByRole('button', { name: 'Save' }))
      if (!allowed) {
        const dialog = await screen.findByRole('alertdialog', { name: 'Save without your own IP?' })
        expect(server.writes).toHaveLength(0)
        await user.click(within(dialog).getByRole('button', { name: 'Save anyway' }))
      }
      await waitFor(() =>
        expect(server.writes).toEqual([
          {
            enabled: true,
            group_id: 'group-1',
            access_points: ['webapp', 'service_api'],
            expected_version: 2,
          },
        ]),
      )
      expect(server.checks).toBeGreaterThan(checksBeforeSave)
      expect(await screen.findByRole('switch', { name: 'Restrict by IP address' })).toBeChecked()
      expect(within(getChip()).getByText('2 of 3')).toBeInTheDocument()
    },
  )

  it.each([true, false])(
    'uses the server match result and only confirms a published denial (allowed: %s)',
    async (allowed) => {
      const user = userEvent.setup()
      const server = setupBindingServer()
      server.check.allowed = allowed
      renderEntry({ plan: 'professional', groups: server.groups, isPublished: true })
      await openSelectedConfig(user)
      await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
      expect(Boolean(screen.queryByText(lockoutWarning))).toBe(!allowed)
      await user.click(screen.getByRole('button', { name: 'Save' }))
      if (allowed) {
        await waitFor(() => expect(server.writes).toHaveLength(1))
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      } else {
        const dialog = await screen.findByRole('alertdialog', { name: 'Save without your own IP?' })
        expect(within(dialog).getByText(lockoutWarning)).toBeInTheDocument()
        expect(server.writes).toHaveLength(0)
        await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
        expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument()
        expect(server.writes).toHaveLength(0)
        await user.click(screen.getByRole('button', { name: 'Save' }))
        await user.click(await screen.findByRole('button', { name: 'Save anyway' }))
        await waitFor(() => expect(server.writes).toHaveLength(1))
      }
    },
  )

  it('warns but saves an unpublished draft without confirmation', async () => {
    const user = userEvent.setup()
    const server = setupBindingServer()
    renderEntry({ plan: 'professional', groups: server.groups })
    await openSelectedConfig(user)
    expect(await screen.findByText(lockoutWarning)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(server.writes).toHaveLength(1))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(server.checks).toBeGreaterThanOrEqual(2)
  })

  it('requires renewed confirmation when the policy changes before Save anyway', async () => {
    const user = userEvent.setup()
    const server = setupBindingServer()
    renderEntry({ plan: 'professional', groups: server.groups, isPublished: true })
    await openSelectedConfig(user)
    await screen.findByText(lockoutWarning)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('alertdialog')
    server.check.policy_version = 2
    await user.click(screen.getByRole('button', { name: 'Save anyway' }))
    expect(
      await screen.findByText('This policy changed. Review the warning before saving again.'),
    ).toBeInTheDocument()
    expect(server.writes).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Save anyway' }))
    await waitFor(() => expect(server.writes).toHaveLength(1))
  })

  it('blocks saving on an unavailable IP check and recovers through Retry', async () => {
    const user = userEvent.setup()
    const server = setupBindingServer()
    server.checkStatus = 503
    renderEntry({ plan: 'professional', groups: server.groups, isPublished: true })
    await openSelectedConfig(user)
    expect(
      await screen.findByText('Unable to check your IP address. Please try again.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(server.writes).toHaveLength(0)
    server.checkStatus = 200
    server.check.allowed = true
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(server.writes).toHaveLength(1))
  })

  it('does not write when the fresh save check fails after a successful initial check', async () => {
    const user = userEvent.setup()
    const server = setupBindingServer()
    server.check.allowed = true
    renderEntry({ plan: 'professional', groups: server.groups, isPublished: true })
    await openSelectedConfig(user)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    server.checkStatus = 503
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByText('Unable to check your IP address. Please try again.'),
    ).toBeInTheDocument()
    expect(server.writes).toHaveLength(0)
  })
})

describe('immediate pause and resume', () => {
  it('cancels pause without writing or changing the saved status', async () => {
    const user = userEvent.setup()
    const server = setupBindingServer(createBinding())
    renderEntry({ plan: 'professional', groups: server.groups, binding: server.binding })
    await user.click(getChip())
    await user.click(screen.getByRole('switch', { name: 'Restrict by IP address' }))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    )
    expect(screen.getByRole('switch', { name: 'Restrict by IP address' })).toBeChecked()
    expect(server.writes).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it.each([500, 409])(
    'keeps the saved state and prevents duplicate requests when pause fails (%s)',
    async (status) => {
      const user = userEvent.setup()
      const server = setupBindingServer(createBinding({ access_points: ['webapp', 'mcp'] }))
      let finish!: (response: Response) => void
      server.put = () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        })
      renderEntry({ plan: 'professional', groups: server.groups, binding: server.binding })
      await user.click(getChip())
      await user.click(screen.getByRole('switch', { name: 'Restrict by IP address' }))
      await user.click(screen.getByRole('button', { name: 'Turn off' }))
      const toggle = screen.getByRole('switch', { name: 'Restrict by IP address' })
      await waitFor(() => expect(toggle).toHaveAttribute('aria-disabled', 'true'))
      await user.click(toggle)
      expect(server.writes).toEqual([
        {
          enabled: false,
          group_id: 'group-1',
          access_points: ['webapp', 'mcp'],
          expected_version: 2,
        },
      ])
      if (status === 409)
        server.binding = createBinding({ version: 3, access_points: ['webapp', 'mcp'] })
      await act(async () => finish(Response.json({ message: 'Unable to pause' }, { status })))
      await waitFor(() => expect(toggle).not.toHaveAttribute('aria-disabled', 'true'))
      expect(toggle).toBeChecked()
      expect(within(getChip()).getByText('2 of 3')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
      if (status === 409) {
        await user.click(toggle)
        await user.click(screen.getByRole('button', { name: 'Turn off' }))
        await waitFor(() => expect(server.writes[1]).toMatchObject({ expected_version: 3 }))
        await act(async () =>
          finish(Response.json({ message: 'Unable to pause' }, { status: 500 })),
        )
      }
    },
  )
})

describe('returning from policy creation', () => {
  it.each(['create', 'cancel', 'failure'] as const)(
    'preserves the selected policy and scope draft after %s',
    async (action) => {
      const user = userEvent.setup()
      const server = setupBindingServer()
      renderEntry({ plan: 'professional', groups: server.groups })
      await openSelectedConfig(user)
      await screen.findByText(lockoutWarning)
      await user.click(screen.getByRole('switch', { name: 'MCP Server' }))
      await user.click(screen.getByRole('combobox', { name: 'IP Policy' }))
      await user.click(screen.getByRole('option', { name: 'Add IP Policy' }))
      const dialog = await screen.findByRole('dialog')
      if (action !== 'cancel') {
        await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'New Office')
        await user.type(within(dialog).getByPlaceholderText('10.0.0.0/8'), '10.0.0.0/8')
        if (action === 'failure') server.createStatus = 500
        await user.click(within(dialog).getByRole('button', { name: 'Create' }))
      }
      if (action === 'failure') {
        await waitFor(() =>
          expect(within(dialog).getByRole('button', { name: 'Create' })).not.toHaveAttribute(
            'aria-disabled',
            'true',
          ),
        )
        expect(dialog).toBeInTheDocument()
      }
      if (action !== 'create')
        await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      const select = await screen.findByRole('combobox', { name: 'IP Policy' })
      expect(select).toHaveTextContent('Internal Network')
      if (action === 'create') {
        expect(await screen.findByRole('option', { name: /New Office/ })).toHaveAttribute(
          'aria-selected',
          'false',
        )
        await user.keyboard('{Escape}')
      }
      expect(screen.getByRole('switch', { name: 'MCP Server' })).not.toBeChecked()
      expect(server.writes).toHaveLength(0)
    },
  )
})
