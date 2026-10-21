import type { AgentAppDetailWithSite } from '@dify/contracts/api/console/agent/types.gen'
import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentPermission } from '@/features/agent-v2/acl'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createAgentFixture } from '@/test/fixtures/agent'
import { AgentDetailSection, AgentDetailTop } from '../navigation'

const mocks = vi.hoisted(() => ({
  deleteAgent: vi.fn(),
  exportAppDsl: vi.fn(),
  pathname: '/agents/agent-1/configure',
  deploymentEdition: 'ENTERPRISE' as DeploymentEdition,
  queryData: undefined as ReturnType<typeof createAgentFixture> | undefined,
  replace: vi.fn(),
}))

vi.mock('@/features/agent-v2/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/agent-v2/permissions')>()),
  useCanCreateAgents: () => true,
}))
vi.mock('@/app/components/app/use-export-app-dsl', () => ({
  useExportAppDsl: () => ({
    exportAppDsl: mocks.exportAppDsl,
    isExporting: false,
  }),
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useSelectedLayoutSegment: () => mocks.pathname.split('/').at(-1),
  useRouter: () => ({
    back: vi.fn(),
    replace: mocks.replace,
  }),
}))

vi.mock('@/app/components/app-sidebar/nav-link', () => ({
  default: ({ disabled, href, name }: { disabled?: boolean; href: string; name: string }) =>
    disabled ? <button disabled>{name}</button> : <a href={href}>{name}</a>,
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'agent.byAgentId.delete': mocks.deleteAgent,
      'agent.byAgentId.get': async () => mocks.queryData,
    }),
  }
})

const createAgent = (overrides: Partial<AgentAppDetailWithSite> = {}) =>
  createAgentFixture({
    permission_keys: Object.values(AgentPermission),
    app_id: 'app-1',
    description: 'Find and summarize market materials.',
    enable_api: true,
    enable_site: true,
    icon: '🧪',
    icon_background: '#E0F2FE',
    icon_type: 'emoji',
    id: 'agent-1',
    icon_url: null,
    mode: 'agent',
    name: 'Research Agent',
    role: 'Research Assistant',
    ...overrides,
  })

function renderAgentDetailSection(expand = true) {
  const { queryClient, wrapper } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: mocks.deploymentEdition, rbac_enabled: true },
  })
  queryClient.setQueryData(
    consoleQuery.agent.byAgentId.get.queryKey({ input: { params: { agent_id: 'agent-1' } } }),
    mocks.queryData,
  )
  return render(<AgentDetailSection expand={expand} />, { wrapper })
}

describe('AgentDetailSection', () => {
  beforeEach(() => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(32)
    vi.clearAllMocks()
    mocks.deleteAgent.mockResolvedValue({})
    mocks.exportAppDsl.mockResolvedValue(undefined)
    mocks.pathname = '/agents/agent-1/configure'
    mocks.queryData = createAgent()
    mocks.deploymentEdition = 'ENTERPRISE'
  })

  afterEach(() => vi.restoreAllMocks())

  it('renders the current agent avatar, name, and role', () => {
    renderAgentDetailSection()
    expect(screen.getByText('Research Agent')).toBeInTheDocument()
    expect(screen.getByText('Research Assistant')).toBeInTheDocument()
    expect(screen.queryByText('agent')).not.toBeInTheDocument()
    expect(screen.queryByText('agentV2.agentDetail.title')).not.toBeInTheDocument()
    expect(screen.getByText('🧪')).toBeInTheDocument()
  })

  it('renders an uploaded sidebar avatar using its signed URL', () => {
    mocks.queryData = createAgent({
      icon_type: 'image',
      icon: 'uploaded-file-id',
      icon_url: 'https://files.example.com/avatar.png?sign=signature',
    })
    const { container } = renderAgentDetailSection()

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'https://files.example.com/avatar.png?sign=signature',
    )
  })

  it('preserves an external sidebar avatar when icon_url is null', () => {
    mocks.queryData = createAgent({
      icon_type: 'link',
      icon: 'https://example.com/avatar.png',
      icon_url: null,
    })
    const { container } = renderAgentDetailSection()

    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.com/avatar.png')
  })

  it('shows a fallback without exposing the file ID when the signed URL is missing', () => {
    mocks.queryData = createAgent({
      icon_type: 'image',
      icon: 'uploaded-file-id',
      icon_url: null,
    })
    const { container } = renderAgentDetailSection()

    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(screen.queryByText('uploaded-file-id')).not.toBeInTheDocument()
    expect(screen.getByText('🤖')).toBeInTheDocument()
  })

  it.each([null, '', '   '])(
    'omits an empty role while keeping the agent accessible (%s)',
    (role) => {
      mocks.queryData = createAgent({ role })
      renderAgentDetailSection()

      expect(screen.getByText('Research Agent')).toBeInTheDocument()
      expect(screen.queryByText('Research Assistant')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Research Agent/ })).toBeInTheDocument()
    },
  )

  it('exports the Agent App package from the detail action menu', async () => {
    const user = userEvent.setup()
    renderAgentDetailSection()

    await user.click(screen.getByRole('button', { name: /agentRoster\.roster\.moreActions/ }))
    await user.click(screen.getByRole('menuitem', { name: 'agentV2.exportAgent' }))

    expect(mocks.exportAppDsl).toHaveBeenCalledWith({
      format: 'ifpkg',
      appId: 'app-1',
      appName: 'Research Agent',
    })
  })

  it('returns to the roster after deleting the current agent', async () => {
    const user = userEvent.setup()
    renderAgentDetailSection()

    await user.click(screen.getByRole('button', { name: /agentRoster\.roster\.moreActions/ }))
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.delete' }))

    const dialog = await screen.findByRole('alertdialog', {
      name: /agentRoster\.roster\.deleteDialog\.title/,
    })
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.delete' }))

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith('/agents')
    })
    expect(mocks.deleteAgent).toHaveBeenCalledExactlyOnceWith({
      params: {
        agent_id: 'agent-1',
      },
    })
  })

  it('keeps the current agent open when deletion fails', async () => {
    const user = userEvent.setup()
    mocks.deleteAgent.mockRejectedValue(new Error('Delete failed'))
    renderAgentDetailSection()

    await user.click(screen.getByRole('button', { name: /agentRoster\.roster\.moreActions/ }))
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.delete' }))

    const dialog = await screen.findByRole('alertdialog', {
      name: /agentRoster\.roster\.deleteDialog\.title/,
    })
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.delete' }))

    await waitFor(() => {
      expect(mocks.deleteAgent).toHaveBeenCalled()
    })
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(dialog).toBeInTheDocument()
  })

  it('does not render more actions in collapsed sidebar mode', () => {
    renderAgentDetailSection(false)

    expect(
      screen.queryByRole('button', { name: /agentRoster\.roster\.moreActions/ }),
    ).not.toBeInTheDocument()
  })

  it('links published Agents with test-and-run access to evaluation', () => {
    renderAgentDetailSection()

    expect(
      screen.getByRole('link', { name: 'agentV2.agentDetail.sections.evaluation' }),
    ).toHaveAttribute('href', '/agents/agent-1/evaluation')
  })

  it('disables evaluation until the Agent has a published snapshot', () => {
    mocks.queryData = createAgent({ access_ready: false })
    renderAgentDetailSection()

    expect(
      screen.getByRole('button', { name: 'agentV2.agentDetail.sections.evaluation' }),
    ).toBeDisabled()
    expect(
      screen.queryByRole('link', { name: 'agentV2.agentDetail.sections.evaluation' }),
    ).not.toBeInTheDocument()
  })

  it('hides evaluation without test-and-run permission', () => {
    mocks.queryData = createAgent({ permission_keys: [AgentPermission.Preview] })
    renderAgentDetailSection()

    expect(screen.queryByText('agentV2.agentDetail.sections.evaluation')).not.toBeInTheDocument()
  })

  it('hides evaluation in the community edition', () => {
    mocks.deploymentEdition = 'COMMUNITY'

    renderAgentDetailSection()

    expect(screen.queryByText('agentV2.agentDetail.sections.evaluation')).not.toBeInTheDocument()
  })
})

describe('AgentDetailTop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('links the combined home control to home', () => {
    render(<AgentDetailTop />)

    expect(screen.getByRole('link', { name: 'navigation.mainNav.home' })).toHaveAttribute(
      'href',
      '/',
    )
    expect(screen.getByRole('link', { name: 'Agents' })).toHaveAttribute('href', '/agents')
    expect(screen.queryByRole('button', { name: 'common.operation.back' })).not.toBeInTheDocument()
  })
})
