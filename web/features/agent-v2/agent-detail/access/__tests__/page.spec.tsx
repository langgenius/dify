import type { AgentAppDetailWithSite } from '@dify/contracts/api/console/agent/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { AgentPermission } from '@/features/agent-v2/acl'
import { consoleQuery } from '@/service/console'
import {
  createNetworkAccessGroupFixture,
  seedAppNetworkAccessGroup,
  seedNetworkAccessGroups,
} from '@/test/console/network-access'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createAgentFixture } from '@/test/fixtures/agent'
import { AgentAccessPage } from '../page'

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.test${path}`,
}))

// These cards own independent publishing and API-key workflows.
vi.mock('../components/web-app-access-card', () => ({ WebAppAccessCard: () => null }))
vi.mock('../components/service-api-access-card', () => ({ ServiceApiAccessCard: () => null }))
vi.mock('../components/workflow-references-table', () => ({ WorkflowReferencesTable: () => null }))

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({
    'studio.accessControl.entryLabel': 'Access Control',
    'studio.accessControl.chipOff': 'Off',
    'studio.accessControl.chipOn': 'ON',
    'studio.accessControl.chipPartial': '{{n}} of {{m}}',
    'studio.accessControl.restrictByIp': 'Restrict by IP address',
    'studio.accessControl.protectingAll': 'Protecting all {{count}} access points.',
    'studio.accessControl.selectPolicy': 'Select a policy',
    'studio.accessControl.ipPolicy': 'IP Policy',
    'studio.accessControl.manageIpPolicies': 'Manage IP policies',
    'overview.appInfo.title': 'Web App',
    'overview.apiInfo.title': 'Backend Service API',
    'mcp.server.title': 'MCP Server',
    'settings.trigger': 'Trigger',
    'operation.save': 'Save',
    'operation.edit': 'Edit',
    'operation.cancel': 'Cancel',
  })
})

function setup(overrides: Partial<AgentAppDetailWithSite> = {}, configured = false) {
  const queryClient = createConsoleQueryClient()
  const agent = createAgentFixture({
    app_id: 'public-app',
    backing_app_id: 'runtime-app',
    hidden_app_backed: false,
    ...overrides,
  })
  queryClient.setQueryData(
    consoleQuery.agent.byAgentId.get.queryKey({ input: { params: { agent_id: agent.id } } }),
    agent,
  )
  const policy = createNetworkAccessGroupFixture()
  seedNetworkAccessGroups(queryClient, { groups: [policy] })
  const binding = configured
    ? {
        id: 'binding-1',
        tenant_id: 'workspace-1',
        app_id: 'public-app',
        enabled: true,
        group_id: policy.id,
        access_points: ['webapp', 'service_api'] as const,
        version: 1,
        updated_by_account_id: null,
        created_at: policy.created_at,
        updated_at: policy.updated_at,
      }
    : null
  const appBinding = seedAppNetworkAccessGroup(queryClient, 'public-app', {
    available_access_points: ['webapp', 'service_api'],
    binding: binding ? { ...binding, access_points: [...binding.access_points] } : null,
    effective_enabled: configured,
  })
  const renderPage = (agentId: string) => (
    <NuqsTestingAdapter>
      <AgentAccessPage agentId={agentId} />
    </NuqsTestingAdapter>
  )
  const rendered = renderWithConsoleQuery(renderPage(agent.id), {
    queryClient,
    currentWorkspace: { id: 'workspace-1', role: 'editor' },
    systemFeatures: { deployment_edition: 'CLOUD' },
  })
  return { ...rendered, agent, policy, appBinding, renderPage }
}

describe('Agent IP access configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lets an Editor configure the public App ID with exactly two access points', async () => {
    const user = userEvent.setup()
    const { appBinding, policy } = setup({
      access_ready: false,
      enable_site: false,
      enable_api: false,
    })
    const writes: Array<{ url: string; body: unknown }> = []
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init)
      if (request.method === 'PUT') {
        const body = await request.json()
        writes.push({ url: request.url, body })
      }
      if (request.url.includes('/workspaces/current/network-access-groups'))
        return Response.json({ tenant_id: 'workspace-1', entitled: true, groups: [policy] })
      return Response.json(appBinding)
    })

    await user.click(await screen.findByRole('button', { name: /Access Control/ }))
    expect(screen.getByRole('switch', { name: 'Web App' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Backend Service API' })).toBeChecked()
    expect(screen.queryByRole('switch', { name: 'MCP Server' })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Trigger' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /Internal Network/ }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(writes).toEqual([
        {
          url: 'http://localhost:5001/console/api/apps/public-app/network-access-group',
          body: {
            enabled: true,
            group_id: 'group-1',
            access_points: ['webapp', 'service_api'],
            expected_version: 0,
          },
        },
      ]),
    )
  })

  it.each([{ app_id: null }, { hidden_app_backed: true }, { permission_keys: [] }])(
    'does not offer an independent IP binding for an ineligible Agent: %o',
    (overrides) => {
      setup(overrides)
      expect(screen.queryByRole('button', { name: /Access Control/ })).not.toBeInTheDocument()
      expect(globalThis.fetch).not.toHaveBeenCalled()
    },
  )

  it('shows both protected endpoints as complete coverage for a read-only Agent', async () => {
    const user = userEvent.setup()
    setup({ permission_keys: [AgentPermission.AccessPointView] }, true)
    const chip = await screen.findByRole('button', { name: /Access Control/ })
    expect(chip).toHaveTextContent('ON')
    await user.click(chip)
    expect(screen.getByText('Protecting all 2 access points.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    const toggle = screen.getByRole('switch', { name: 'Restrict by IP address' })
    expect(toggle).toHaveAttribute('aria-disabled', 'true')
    await user.click(toggle)
    expect(toggle).toBeChecked()
    expect(
      vi
        .mocked(globalThis.fetch)
        .mock.calls.filter(([input]) => input instanceof Request && input.method !== 'GET'),
    ).toHaveLength(0)
  })

  it('closes an unsaved policy draft when switching Agents', async () => {
    const user = userEvent.setup()
    const { queryClient, rerender, renderPage } = setup()
    await user.click(await screen.findByRole('button', { name: /Access Control/ }))
    await user.click(screen.getByRole('option', { name: /Internal Network/ }))
    await user.click(screen.getByRole('switch', { name: 'Backend Service API' }))

    const second = createAgentFixture({ id: 'agent-2', app_id: 'second-app' })
    queryClient.setQueryData(
      consoleQuery.agent.byAgentId.get.queryKey({ input: { params: { agent_id: second.id } } }),
      second,
    )
    seedAppNetworkAccessGroup(queryClient, 'second-app', {
      available_access_points: ['webapp', 'service_api'],
    })
    rerender(renderPage(second.id))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument(),
    )
    await user.click(screen.getByRole('button', { name: /Access Control/ }))
    expect(screen.getByRole('switch', { name: 'Backend Service API' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})
