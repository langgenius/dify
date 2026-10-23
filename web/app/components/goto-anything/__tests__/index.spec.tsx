import type { MarketplacePlugin } from '@dify/contracts/marketplace'
import type { consoleClient } from '@/service/console'
import type { marketplaceClient } from '@/service/marketplace'
import { zAgentAppPartial } from '@dify/contracts/api/console/agent/zod.gen'
import { zAppPartial } from '@dify/contracts/api/console/apps/zod.gen'
import { zSkillResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { detectPlatform, useHotkey } from '@tanstack/react-hotkeys'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from 'next-themes'
import { useReactFlow } from 'reactflow'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { useWorkflowSearch } from '@/app/components/workflow/hooks/use-workflow-search'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import { seedCurrentWorkspaceQuery } from '@/test/console/current-workspace'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createAgentFixture } from '@/test/fixtures/agent'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createPluginDeclarationFixture } from '@/test/fixtures/plugin'
import { SYSTEM_MODELS_PATH } from '../actions/commands/models'
import { GotoAnything } from '../index'

const api = vi.hoisted(() => ({
  apps: vi.fn<typeof consoleClient.apps.get>(),
  datasets: vi.fn<typeof consoleClient.datasets.get>(),
  skills: vi.fn<typeof consoleClient.workspaces.current.skills.get>(),
  agents: vi.fn<typeof consoleClient.agent.get>(),
  marketplace: vi.fn<typeof marketplaceClient.searchAdvanced>(),
  install: vi.fn<typeof consoleClient.workspaces.current.plugin.install.marketplace.post>(),
  push: vi.fn(),
  agentEnabled: true,
  pathname: '/',
}))
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useRouter: () => ({ push: api.push }),
  usePathname: () => api.pathname,
  useParams: () => ({}),
}))
vi.mock('@/features/agent-v2/feature-flag', () => ({
  isAgentV2Enabled: () => api.agentEnabled,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.get': api.apps,
      'workspaces.current.defaultModel.get': async () => ({ data: null }),
      'workspaces.current.tools.builtin.get': async () => [],
      'workspaces.current.tools.api.get': async () => [],
      'workspaces.current.tools.workflow.get': async () => [],
      'workspaces.current.tools.mcp.get': async () => [],
      'datasets.get': api.datasets,
      'workspaces.current.skills.get': api.skills,
      'agent.get': api.agents,
      'workspaces.current.plugin.list.installations.ids.post': async () => ({ plugins: [] }),
      'workspaces.current.models.modelTypes.byModelType.get': async () => ({ data: [] }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.permission.fetch.get': async () => ({
        install_permission: 'everyone',
        debug_permission: 'everyone',
      }),
      'workspaces.current.plugin.tasks.get': async () => ({ tasks: [] }),
      'workspaces.current.plugin.marketplace.pkg.get': async () => ({
        manifest: createPluginDeclarationFixture(),
      }),
      'workspaces.current.plugin.install.marketplace.post': api.install,
    }),
  }
})
vi.mock('@/service/marketplace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/marketplace')>()
  return {
    ...actual,
    marketplaceQuery: {
      ...actual.marketplaceQuery,
      searchAdvanced: {
        ...actual.marketplaceQuery.searchAdvanced,
        queryOptions: (
          options: Parameters<typeof actual.marketplaceQuery.searchAdvanced.queryOptions>[0],
        ) => {
          const original = actual.marketplaceQuery.searchAdvanced.queryOptions(options)
          const input = options.input
          return typeof input === 'symbol'
            ? original
            : { ...original, queryFn: () => api.marketplace(input) }
        },
      },
    },
  }
})

const page = <T,>(data: T[]) => ({ data, has_more: false, limit: 10, page: 1, total: data.length })
const app = (name = 'Research app') =>
  zAppPartial.parse(createAppDetailFixture({ name, permission_keys: ['app.acl.view_layout'] }))
const plugin: MarketplacePlugin = {
  type: 'plugin',
  org: 'dify',
  name: 'research-tool',
  plugin_id: 'dify/research-tool',
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_package_identifier: 'dify/research-tool:1.0.0@hash',
  icon: '',
  verified: true,
  label: { en_US: 'Research plugin' },
  brief: { en_US: 'Research tools' },
  introduction: '',
  repository: '',
  category: 'tool',
  install_count: 1,
  endpoint: { settings: [] },
  tags: [],
  badges: [],
  verification: { authorized_category: 'community' },
  from: 'marketplace',
}
const darkTheme = /app.gotoAnything.actions.themeDark/
const isMac = detectPlatform() === 'mac'
const triggerSearchShortcut = (target: HTMLElement = document.body) =>
  fireEvent.keyDown(target, { key: 'k', ctrlKey: !isMac, metaKey: isMac })

function setup({ datasetOperator = false, enableSkill = true, canInstall = true } = {}) {
  const { wrapper: ConsoleWrapper, queryClient } = createConsoleQueryWrapper({
    currentWorkspace: { role: datasetOperator ? 'dataset_operator' : 'owner' },
    features: { enable_skill: enableSkill },
    accountProfileMeta: { currentVersion: '1.0.0' },
    workspacePermissionKeys: canInstall ? ['plugin.install'] : [],
    systemFeatures: {
      rbac_enabled: true,
      plugin_installation_permission: {
        plugin_installation_scope: 'all',
        restrict_to_marketplace_only: false,
      },
    },
  })
  render(
    <ConsoleWrapper>
      <ThemeProvider defaultTheme="light" enableSystem={false}>
        <GotoAnything />
        <AppToaster timeout={0} />
      </ThemeProvider>
    </ConsoleWrapper>,
  )
  return { user: userEvent.setup(), queryClient }
}
async function openSearch() {
  triggerSearchShortcut()
  const input = await screen.findByRole('combobox', { name: 'app.gotoAnything.searchTitle' })
  await waitFor(() => expect(input).toHaveFocus())
  return input
}

beforeEach(() => {
  api.apps.mockReset().mockResolvedValue(page([]))
  api.datasets.mockReset().mockResolvedValue(page([]))
  api.skills.mockReset().mockResolvedValue(page([]))
  api.agents
    .mockReset()
    .mockResolvedValue({ ...page([]), publication_counts: { drafts: 0, published: 0 } })
  api.marketplace.mockReset().mockResolvedValue({ data: { plugins: [], total: 0 } })
  api.install.mockReset().mockResolvedValue({ all_installed: true, task_id: '' })
  api.push.mockReset()
  api.agentEnabled = true
  api.pathname = '/'
})
afterEach(() => {
  vi.restoreAllMocks()
  act(() => toast.dismiss())
})

describe('search shortcut ownership', () => {
  it('suspends background commands while search is open and restores them after closing', async () => {
    const save = vi.fn()
    function BackgroundEditor() {
      useHotkey('Mod+S', save)
      return <button onClick={save}>Save document</button>
    }
    const { user } = setup()
    render(<BackgroundEditor />)
    const pressSave = (target: HTMLElement) =>
      fireEvent.keyDown(target, { key: 's', ctrlKey: !isMac, metaKey: isMac })

    pressSave(screen.getByRole('button', { name: 'Save document' }))
    expect(save).toHaveBeenCalledTimes(1)
    const input = await openSearch()
    pressSave(input)
    expect(save).toHaveBeenCalledTimes(1)
    expect(triggerSearchShortcut(input)).toBe(false)
    expect(
      fireEvent.keyDown(input, { key: 'k', ctrlKey: !isMac, metaKey: isMac, repeat: true }),
    ).toBe(false)
    expect(input).toHaveFocus()
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'app.gotoAnything.searchTitle' }),
      ).not.toBeInTheDocument(),
    )
    pressSave(screen.getByRole('button', { name: 'Save document' }))
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('opens search, keeps the current query on a repeated shortcut, and clears it after closing', async () => {
    const { user } = setup()
    const input = await openSearch()
    expect(input).toHaveFocus()
    await user.type(input, 'research')
    triggerSearchShortcut()
    expect(input).toHaveValue('research')
    expect(input).toHaveFocus()
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'app.gotoAnything.searchTitle' }),
      ).not.toBeInTheDocument(),
    )
    expect(await openSearch()).toHaveValue('')
  })

  it('leaves shortcuts in unrelated editable controls to their owner', async () => {
    setup()
    render(<input aria-label="Other editor" />)
    const input = screen.getByRole('textbox', { name: 'Other editor' })
    triggerSearchShortcut(input)
    expect(
      screen.queryByRole('dialog', { name: 'app.gotoAnything.searchTitle' }),
    ).not.toBeInTheDocument()
  })

  it('respects a shortcut already consumed by a local handler', () => {
    setup()
    render(<button onKeyDown={(event) => event.preventDefault()}>Local shortcut</button>)
    triggerSearchShortcut(screen.getByRole('button', { name: 'Local shortcut' }))
    expect(
      screen.queryByRole('dialog', { name: 'app.gotoAnything.searchTitle' }),
    ).not.toBeInTheDocument()
  })

  it.each(['shiftKey', 'altKey'] as const)('does not claim Mod+K with %s', (modifier) => {
    setup()
    fireEvent.keyDown(document, { key: 'k', ctrlKey: !isMac, metaKey: isMac, [modifier]: true })
    expect(
      screen.queryByRole('dialog', { name: 'app.gotoAnything.searchTitle' }),
    ).not.toBeInTheDocument()
  })

  it('does not claim K with the other platform modifier', () => {
    setup()
    fireEvent.keyDown(document, { key: 'k', ctrlKey: isMac, metaKey: !isMac })
    expect(
      screen.queryByRole('dialog', { name: 'app.gotoAnything.searchTitle' }),
    ).not.toBeInTheDocument()
  })
})

describe('real commands', () => {
  it('lets shortcut controls select a prefix and return focus to typing', async () => {
    const { user } = setup()
    const input = await openSearch()
    const commands = screen.getByRole('button', { name: 'app.gotoAnything.groups.commands' })
    const scopes = screen.getByRole('button', { name: 'app.gotoAnything.selectSearchType' })
    await user.tab()
    expect(commands).toHaveFocus()
    await user.tab()
    expect(scopes).toHaveFocus()
    await user.tab()
    expect(input).toHaveFocus()
    await user.click(commands)
    expect(input).toHaveValue('/')
    expect(input).toHaveFocus()
    expect(screen.getByRole('gridcell', { name: /\/models/ })).toHaveTextContent(
      'modelProvider.modelProvider.systemModelSettings',
    )
    await user.clear(input)
    await user.click(screen.getByRole('button', { name: 'app.gotoAnything.selectSearchType' }))
    expect(input).toHaveValue('@')
    expect(input).toHaveFocus()
    expect(screen.getByRole('gridcell', { name: /@kb/ })).toHaveTextContent(
      'app.gotoAnything.actions.searchKnowledgeBasesDesc',
    )
  })

  it('commits a submenu before executing a real theme choice', async () => {
    const { user } = setup()
    const input = await openSearch()
    await user.type(input, '/theme')
    expect(screen.getByRole('gridcell', { name: /\/theme/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: darkTheme })).not.toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(input).toHaveValue('/theme ')
    await user.click(await screen.findByRole('option', { name: darkTheme }))
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'app.gotoAnything.searchTitle' }),
      ).not.toBeInTheDocument(),
    )
    expect(localStorage.getItem('theme')).toBe('dark')
  })

  it('executes a direct command once without a resource search', async () => {
    const { user } = setup()
    await user.type(await openSearch(), '/models')
    await screen.findByRole('gridcell', { name: /\/models/ })
    await user.keyboard('{Enter}')
    expect(api.push).toHaveBeenCalledExactlyOnceWith(SYSTEM_MODELS_PATH)
    expect(api.apps).not.toHaveBeenCalled()
  })

  it('finds an action by name even when every remote provider fails', async () => {
    for (const request of [api.apps, api.datasets, api.skills, api.agents, api.marketplace])
      request.mockRejectedValue(new Error('Unavailable'))
    const { user } = setup()
    await user.type(await openSearch(), 'models')
    await waitFor(() => expect(api.apps).toHaveBeenCalled())
    await user.click(
      await screen.findByRole('option', {
        name: /modelProvider.modelProvider.systemModelSettings/,
      }),
    )
    expect(api.push).toHaveBeenCalledExactlyOnceWith(SYSTEM_MODELS_PATH)
  })

  it('keeps the selected command stable when remote results arrive', async () => {
    const pending = createDeferred<Awaited<ReturnType<typeof api.apps>>>()
    api.apps.mockReturnValue(pending.promise)
    const { user } = setup()
    const input = await openSearch()
    await user.type(input, 'models')
    const command = await screen.findByRole('option', {
      name: /modelProvider.modelProvider.systemModelSettings/,
    })
    await user.keyboard('{ArrowDown}')
    expect(input).toHaveAttribute('aria-activedescendant', command.id)
    await act(async () => pending.resolve(page([app('Models app')])))
    await screen.findByRole('option', { name: /Models app/ })
    expect(input).toHaveAttribute('aria-activedescendant', command.id)
    await user.keyboard('{Enter}')
    expect(api.push).toHaveBeenCalledExactlyOnceWith(SYSTEM_MODELS_PATH)
  })

  it('refreshes an open navigation submenu when workspace access changes', async () => {
    const { user, queryClient } = setup()
    await user.type(await openSearch(), '/go ')
    expect(await screen.findByRole('option', { name: /Skills/ })).toBeInTheDocument()
    act(() => seedCurrentWorkspaceQuery(queryClient, { role: 'dataset_operator' }))
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /Skills/ })).not.toBeInTheDocument(),
    )
    await user.click(screen.getByRole('option', { name: /Knowledge/ }))
    expect(api.push).toHaveBeenCalledExactlyOnceWith('/datasets')
  })

  it('reports an external command failure and allows another attempt', async () => {
    const external = vi
      .spyOn(window, 'open')
      .mockImplementationOnce(() => {
        throw new Error('Window unavailable')
      })
      .mockReturnValue(null)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { user } = setup()
    await user.type(await openSearch(), '/docs')
    await user.keyboard('{Enter}')
    expect(await screen.findByText('common.api.actionFailed')).toBeInTheDocument()
    expect(error).toHaveBeenCalledWith('Goto Anything command failed:', expect.any(Error))
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'app.gotoAnything.searchTitle' }),
      ).not.toBeInTheDocument(),
    )
    await user.type(await openSearch(), '/docs')
    await user.keyboard('{Enter}')
    expect(external).toHaveBeenCalledTimes(2)
    expect(external).toHaveBeenLastCalledWith(
      expect.stringMatching(/^https:/),
      '_blank',
      'noopener,noreferrer',
    )
  })
})

describe('resource search', () => {
  it.each([
    ['app', '/app/app-1/configuration'],
    ['knowledge', '/datasets/dataset-1/documents'],
    ['skill', '/skills/skill-1'],
    ['agent', '/agents/agent-1/configure'],
  ])('maps the %s response to its actual destination', async (kind, destination) => {
    api.apps.mockResolvedValue(page([app()]))
    api.datasets.mockResolvedValue(page([createDatasetFixture({ name: 'Research knowledge' })]))
    api.skills.mockResolvedValue(
      page([
        zSkillResponse.parse({
          id: 'skill-1',
          name: 'research',
          display_name: 'Research skill',
          description: '',
          icon: '',
          visibility: 'private',
          created_at: 1,
          updated_at: 1,
        }),
      ]),
    )
    api.agents.mockResolvedValue({
      ...page([zAgentAppPartial.parse(createAgentFixture({ name: 'Research agent' }))]),
      publication_counts: { drafts: 0, published: 1 },
    })
    const { user } = setup()
    await user.type(await openSearch(), 'research')
    await user.click(await screen.findByRole('option', { name: new RegExp(`Research ${kind}`) }))
    expect(api.push).toHaveBeenCalledExactlyOnceWith(destination)
  })

  it('uses hit testing as the destination for external knowledge', async () => {
    api.datasets.mockResolvedValue(
      page([createDatasetFixture({ name: 'External knowledge', provider: 'external' })]),
    )
    const { user } = setup()
    await user.type(await openSearch(), '@kb external')
    await user.click(await screen.findByRole('option', { name: /External knowledge/ }))
    expect(api.push).toHaveBeenCalledExactlyOnceWith('/datasets/dataset-1/hitTesting')
  })

  it.each(['chat', 'workflow'] as const)(
    'offers %s app sections only in scoped search',
    async (mode) => {
      api.apps.mockResolvedValue(page([{ ...app(), mode }]))
      const { user } = setup()
      const input = await openSearch()
      await user.type(input, 'research')
      await screen.findByRole('option', { name: /Research app/ })
      expect(screen.queryByRole('option', { name: /Research app \/ Logs/ })).not.toBeInTheDocument()
      await user.clear(input)
      await user.type(input, '@app research')
      expect(
        await screen.findByRole('option', {
          name: new RegExp(`Research app / ${mode === 'workflow' ? 'Workflow' : 'Configuration'}`),
        }),
      ).toBeInTheDocument()
      await user.click(screen.getByRole('option', { name: /Research app \/ Logs/ }))
      expect(api.push).toHaveBeenCalledExactlyOnceWith('/app/app-1/logs')
    },
  )

  it('navigates the highlighted resource with the keyboard', async () => {
    api.apps.mockResolvedValue(page([app('Unique keyboard result')]))
    const { user } = setup()
    await user.type(await openSearch(), 'unique')
    await screen.findByRole('option', { name: /Unique keyboard result/ })
    await user.keyboard('{ArrowDown}{Enter}')
    expect(api.push).toHaveBeenCalledExactlyOnceWith('/app/app-1/configuration')
  })

  it.each([{ datasetOperator: true }, { enableSkill: false }])(
    'hides and excludes skills when workspace capabilities disallow them: %j',
    async (options) => {
      const { user } = setup(options)
      const input = await openSearch()
      expect(screen.queryByRole('gridcell', { name: /@skill/ })).not.toBeInTheDocument()
      await user.type(input, 'research')
      await waitFor(() => expect(api.apps).toHaveBeenCalled())
      expect(api.skills).not.toHaveBeenCalled()
    },
  )

  it('hides and excludes agents when the feature is disabled', async () => {
    api.agentEnabled = false
    const { user } = setup()
    const input = await openSearch()
    expect(screen.queryByRole('gridcell', { name: /@agents/ })).not.toBeInTheDocument()
    await user.type(input, 'research')
    await waitFor(() => expect(api.apps).toHaveBeenCalled())
    expect(api.agents).not.toHaveBeenCalled()
  })

  it.each([
    ['@app', 'apps', { page: 1, name: 'research' }],
    ['@kb', 'datasets', { page: 1, limit: 10, keyword: 'research' }],
    ['@skill', 'skills', { page: 1, limit: 10, keyword: 'research' }],
    ['@agents', 'agents', { page: 1, limit: 10, name: 'research', sort_by: 'last_modified' }],
  ] as const)(
    'searches only the selected %s provider with a trimmed term',
    async (scope, provider, query) => {
      const { user } = setup()
      await user.type(await openSearch(), `${scope} research `)
      await waitFor(() => expect(api[provider]).toHaveBeenCalledWith({ query }))
      for (const other of ['apps', 'datasets', 'skills', 'agents', 'marketplace'] as const)
        if (other !== provider) expect(api[other]).not.toHaveBeenCalled()
    },
  )

  it('does not send a scope prefix as a remote query', async () => {
    const { user } = setup()
    const input = await openSearch()
    await user.type(input, '@')
    await user.click(screen.getByRole('gridcell', { name: /@app/ }))
    expect(input).toHaveValue('@app ')
    await user.type(input, 'research')
    await waitFor(() =>
      expect(api.apps).toHaveBeenCalledWith({ query: { page: 1, name: 'research' } }),
    )
    expect(api.apps).toHaveBeenCalledTimes(1)
  })
})

describe('workflow node integration', () => {
  it('keeps local results aligned with the search term and selects the real graph node', async () => {
    api.pathname = '/app/app-1/workflow'
    const { result } = renderWorkflowFlowHook(
      () => {
        useWorkflowSearch()
        return useReactFlow()
      },
      { nodes: [createNode({ id: 'node-42', data: { title: 'Stable node' } })] },
    )
    const { user } = setup()
    const input = await openSearch()
    await user.type(input, 'stable')
    await screen.findByRole('option', { name: /Stable node/ })
    await waitFor(() =>
      expect(api.apps).toHaveBeenCalledWith({ query: { page: 1, name: 'stable' } }),
    )
    await user.type(input, 'unknown')
    expect(screen.getByRole('option', { name: /Stable node/ })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('app.gotoAnything.searching')
    await screen.findByText('app.gotoAnything.noResults')
    expect(screen.queryByRole('option', { name: /Stable node/ })).not.toBeInTheDocument()
    api.apps.mockClear()
    await user.clear(input)
    await user.type(input, '@node stable')
    await user.click(await screen.findByRole('option', { name: /Stable node/ }))
    expect(result.current.getNode('node-42')?.data.selected).toBe(true)
    expect(api.apps).not.toHaveBeenCalled()
    expect(api.push).not.toHaveBeenCalled()
  })
})

describe('pending and failed searches', () => {
  it('preserves results until the next response replaces them, then announces an empty result', async () => {
    const pending = createDeferred<Awaited<ReturnType<typeof api.apps>>>()
    api.apps.mockResolvedValueOnce(page([app('Stable result')])).mockReturnValue(pending.promise)
    const { user } = setup()
    const input = await openSearch()
    await user.type(input, 'stable')
    await screen.findByRole('option', { name: /Stable result/ })
    await user.type(input, ' next')
    await waitFor(() =>
      expect(api.apps).toHaveBeenCalledWith({ query: { page: 1, name: 'stable next' } }),
    )
    expect(screen.getByRole('option', { name: /Stable result/ })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('app.gotoAnything.searching')
    expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox').id)
    await act(async () => pending.resolve(page([])))
    expect(await screen.findByText('app.gotoAnything.noResults')).toBeInTheDocument()
    expect(screen.queryByText('Stable result')).not.toBeInTheDocument()
  })

  it('does not let a late remote response replace a command submenu', async () => {
    const pending = createDeferred<Awaited<ReturnType<typeof api.apps>>>()
    api.apps.mockReturnValue(pending.promise)
    const { user } = setup()
    const input = await openSearch()
    await user.type(input, 'research')
    await waitFor(() => expect(api.apps).toHaveBeenCalled())
    await user.clear(input)
    await user.type(input, '/theme ')
    await screen.findByRole('option', { name: darkTheme })
    await act(async () => pending.resolve(page([app('Stale result')])))
    expect(screen.queryByText('Stale result')).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: darkTheme })).toBeInTheDocument()
  })

  it('keeps submenu choices visible while a new argument is being debounced', async () => {
    const { user } = setup()
    const input = await openSearch()
    await user.type(input, '/theme')
    await screen.findByRole('gridcell', { name: /\/theme/ })
    await user.keyboard('{Enter}')
    await user.type(input, 'unknown')
    expect(screen.getByRole('option', { name: darkTheme })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('app.gotoAnything.searching')
    expect(await screen.findByText('app.gotoAnything.noResults')).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: darkTheme })).not.toBeInTheDocument()
  })

  it('announces a complete provider failure', async () => {
    for (const request of [api.apps, api.datasets, api.skills, api.agents, api.marketplace])
      request.mockRejectedValue(new Error('Unavailable'))
    const { user } = setup()
    await user.type(await openSearch(), 'zzzz')
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('app.gotoAnything.searchFailed'),
    )
    expect(screen.queryByText('app.gotoAnything.someServicesUnavailable')).not.toBeInTheDocument()
  })

  it('keeps successful results available during a partial failure', async () => {
    api.apps.mockResolvedValue(page([app('Available result')]))
    api.marketplace.mockRejectedValue(new Error('Marketplace unavailable'))
    const { user } = setup()
    await user.type(await openSearch(), 'available')
    await screen.findByRole('option', { name: /Available result/ })
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'app.gotoAnything.someServicesUnavailable',
      ),
    )
    await user.click(screen.getByRole('option', { name: /Available result/ }))
    expect(api.push).toHaveBeenCalledExactlyOnceWith('/app/app-1/configuration')
  })
})

describe('marketplace installation', () => {
  it.each(['cancel', 'install'] as const)(
    'opens the real installer and closes it after %s',
    async (action) => {
      api.marketplace.mockResolvedValue({ data: { plugins: [plugin], total: 1 } })
      const { user } = setup()
      await user.type(await openSearch(), '@plugin research')
      await user.click(await screen.findByRole('option', { name: /Research plugin/ }))
      const installer = await screen.findByRole('dialog', {
        name: 'plugin.installModal.installPlugin',
      })
      expect(within(installer).getByText('Research plugin')).toBeInTheDocument()
      expect(api.marketplace).toHaveBeenCalledWith({
        params: { kind: 'plugins' },
        body: { page: 1, page_size: 10, query: 'research' },
      })
      if (action === 'cancel') {
        await user.click(within(installer).getByRole('button', { name: 'common.operation.cancel' }))
        expect(api.install).not.toHaveBeenCalled()
      } else {
        const install = within(installer).getByRole('button', {
          name: 'plugin.installModal.install',
        })
        await waitFor(() => expect(install).toBeEnabled())
        await user.click(install)
        await screen.findByRole('dialog', { name: 'plugin.installModal.installedSuccessfully' })
        expect(api.install).toHaveBeenCalledWith({
          body: { plugin_unique_identifiers: [plugin.latest_package_identifier] },
        })
        await user.click(
          within(
            screen.getByRole('dialog', { name: 'plugin.installModal.installedSuccessfully' }),
          ).getByText('common.operation.close'),
        )
      }
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: /plugin.installModal/ }),
        ).not.toBeInTheDocument(),
      )
    },
  )

  it('does not open installation without workspace permission', async () => {
    api.marketplace.mockResolvedValue({ data: { plugins: [plugin], total: 1 } })
    const { user } = setup({ canInstall: false })
    await user.type(await openSearch(), '@plugin research')
    await user.click(await screen.findByRole('option', { name: /Research plugin/ }))
    expect(
      screen.queryByRole('dialog', { name: 'plugin.installModal.installPlugin' }),
    ).not.toBeInTheDocument()
    expect(api.install).not.toHaveBeenCalled()
  })
})
