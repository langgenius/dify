import type { DatasourceProviderEntity } from '@dify/contracts/api/console/workspaces/types.gen'
import type { PluginDeclaration, PluginDetail } from '@/app/components/plugins/types'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PluginCategoryEnum, PluginSource } from '@/app/components/plugins/types'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import PluginDetailPanel from '../index'
import { usePluginStore } from '../store'

const { uninstall, upgrade } = vi.hoisted(() => ({ uninstall: vi.fn(), upgrade: vi.fn() }))
vi.mock('@/service/plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/plugins')>()),
  uninstallPlugin: uninstall,
  updateFromMarketPlace: upgrade,
}))
vi.mock('../../plugin-page/use-reference-setting', () => ({
  default: () => ({ referenceSetting: undefined }),
}))
vi.mock('../../install-plugin/hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: vi.fn() }),
}))
vi.mock('../../plugin-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../plugin-auth')>()),
  PluginAuth: ({ pluginPayload }: { pluginPayload: { provider: string } }) => (
    <output data-testid="auth-provider">{pluginPayload.provider}</output>
  ),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { createToolProviderFixture } = await import('@/test/console/tool-provider-fixture')
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.toolProviders.get': async () => [
        createToolProviderFixture({
          name: 'test-plugin-id/provider-a',
          type: 'builtin',
          allow_delete: true,
        }),
      ],
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.tasks.get': async () => ({ tasks: [] }),
    }),
  }
})

vi.mock('../action-list', () => ({ default: () => <div>Actions</div> }))
vi.mock('../agent-strategy-list', () => ({ default: () => <div>Agent strategies</div> }))
vi.mock('../endpoint-list', () => ({ default: () => <div>Endpoints</div> }))
vi.mock('../model-list', () => ({ default: () => <div>Models</div> }))
vi.mock('../datasource-action-list', () => ({ default: () => <div>Data sources</div> }))
vi.mock('../subscription-list', () => ({
  SubscriptionList: () => <div>Subscriptions</div>,
}))
vi.mock('../trigger/event-list', () => ({
  TriggerEventsList: () => <div>Trigger events</div>,
}))
const createPluginDetail = (
  declarationOverrides: Partial<PluginDeclaration> = {},
): PluginDetail => {
  const declaration = {
    plugin_unique_identifier: 'test-plugin-uid',
    version: '1.0.0',
    author: 'test-author',
    icon: 'test-icon.png',
    name: 'test-plugin',
    category: PluginCategoryEnum.tool,
    label: { en_US: 'Test Plugin' },
    description: { en_US: 'Test plugin description' },
    created_at: '2024-01-01T00:00:00Z',
    resource: null,
    plugins: null,
    verified: true,
    endpoint: undefined,
    tool: undefined,
    model: null,
    tags: [],
    agent_strategy: null,
    meta: { version: '1.0.0' },
    trigger: null,
    datasource: null,
    ...declarationOverrides,
  } as unknown as PluginDeclaration

  return {
    id: 'test-plugin-id',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    name: 'Test Plugin',
    plugin_id: 'test-plugin-id',
    plugin_unique_identifier: 'test-plugin-uid',
    declaration,
    installation_id: 'install-1',
    tenant_id: 'tenant-1',
    endpoints_setups: 0,
    endpoints_active: 0,
    version: '1.0.0',
    latest_version: '1.0.0',
    latest_unique_identifier: 'test-plugin-uid',
    source: PluginSource.marketplace,
    meta: undefined,
    status: 'active',
    deprecated_reason: '',
    alternative_plugin_id: '',
  }
}

describe('PluginDetailPanel', () => {
  const onUpdate = vi.fn()
  const onHide = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('publishes the selected plugin to descendants and clears it when the panel is removed', async () => {
    const ContextConsumer = () => {
      const detail = usePluginStore((state) => state.detail)
      return (
        <output data-testid="plugin-context">
          {detail ? `${detail.provider}:${detail.plugin_unique_identifier}` : 'empty'}
        </output>
      )
    }
    const detail = createPluginDetail()
    const { rerender } = render(
      <>
        <ContextConsumer />
        <PluginDetailPanel detail={detail} onUpdate={onUpdate} onHide={onHide} />
      </>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('plugin-context')).toHaveTextContent(
        'test-plugin-id/test-plugin:test-plugin-uid',
      ),
    )
    rerender(
      <>
        <ContextConsumer />
        <PluginDetailPanel onUpdate={onUpdate} onHide={onHide} />
      </>,
    )
    await waitFor(() => expect(screen.getByTestId('plugin-context')).toHaveTextContent('empty'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each([
    ['tool', { tool: {} }, 'Actions'],
    ['agent strategy', { agent_strategy: {} }, 'Agent strategies'],
    ['endpoint', { endpoint: {} }, 'Endpoints'],
    ['model', { model: {} }, 'Models'],
  ] as const)('renders the %s section declared by the plugin', (_, declaration, section) => {
    render(
      <PluginDetailPanel
        detail={createPluginDetail(declaration as Partial<PluginDeclaration>)}
        onUpdate={onUpdate}
        onHide={onHide}
      />,
    )

    expect(screen.getByText(section)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'plugin.readmeInfo.needHelpCheckReadme' }),
    ).toBeInTheDocument()
  })

  it('renders the datasource section only for a present generated declaration', () => {
    const datasource = {
      provider_type: 'local_file',
      identity: {
        author: 'Dify',
        name: 'file',
        icon: 'file.svg',
        label: { en_US: 'Local File' },
        description: { en_US: 'Read local files' },
        tags: [],
      },
      oauth_schema: null,
    } satisfies DatasourceProviderEntity
    const { rerender } = render(
      <PluginDetailPanel
        detail={createPluginDetail({ datasource })}
        onUpdate={onUpdate}
        onHide={onHide}
      />,
    )
    expect(screen.getByText('Data sources')).toBeInTheDocument()

    rerender(
      <PluginDetailPanel
        detail={createPluginDetail({ datasource: null })}
        onUpdate={onUpdate}
        onHide={onHide}
      />,
    )
    expect(screen.queryByText('Data sources')).not.toBeInTheDocument()
  })

  it('renders subscription and event sections for trigger plugins', () => {
    render(
      <PluginDetailPanel
        detail={createPluginDetail({ category: PluginCategoryEnum.trigger })}
        onUpdate={onUpdate}
        onHide={onHide}
      />,
    )

    expect(screen.getByText('Subscriptions')).toBeInTheDocument()
    expect(screen.getByText('Trigger events')).toBeInTheDocument()
  })

  it('updates through the real confirmation dialog without closing the detail panel', async () => {
    const user = userEvent.setup()
    upgrade.mockResolvedValueOnce({ all_installed: true, task_id: '' })
    const detail = {
      ...createPluginDetail(),
      latest_version: '2.0.0',
      latest_unique_identifier: 'new-plugin-uid',
    }
    render(<PluginDetailPanel detail={detail} onUpdate={onUpdate} onHide={onHide} />)
    await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.update' }))
    const dialog = await screen.findByRole('dialog', { name: 'plugin.upgrade.title' })
    await user.click(within(dialog).getByRole('button', { name: 'plugin.upgrade.upgrade' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce())
    expect(upgrade).toHaveBeenCalledWith({
      original_plugin_unique_identifier: 'test-plugin-uid',
      new_plugin_unique_identifier: 'new-plugin-uid',
    })
    expect(onHide).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'plugin.upgrade.title' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('closes before notifying consumers after confirmed plugin deletion', async () => {
    const user = userEvent.setup()
    uninstall.mockResolvedValueOnce({ success: true })
    render(<PluginDetailPanel detail={createPluginDetail()} onUpdate={onUpdate} onHide={onHide} />)
    await user.click(
      screen.getByRole('button', { name: 'plugin.detailPanel.operation.moreActions' }),
    )
    await user.click(
      await screen.findByRole('menuitem', { name: 'plugin.detailPanel.operation.remove' }),
    )
    const confirm = await screen.findByRole('alertdialog')
    expect(uninstall).not.toHaveBeenCalled()
    await user.click(within(confirm).getByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce())
    expect(uninstall).toHaveBeenCalledExactlyOnceWith('test-plugin-id')
    expect(onHide).toHaveBeenCalledOnce()
    expect(onHide.mock.invocationCallOrder[0]!).toBeLessThan(onUpdate.mock.invocationCallOrder[0]!)
  })
  it('connects tool authorization to its provider and links to the matching marketplace entry', async () => {
    const user = userEvent.setup()
    const detail = createPluginDetail({
      tool: { identity: { name: 'provider-a' } } as PluginDeclaration['tool'],
    })
    render(<PluginDetailPanel detail={detail} onUpdate={onUpdate} onHide={onHide} />, {
      systemFeatures: { enable_marketplace: true },
    })
    await waitFor(() =>
      expect(screen.getByTestId('auth-provider')).toHaveTextContent('test-plugin-id/provider-a'),
    )
    await user.click(
      screen.getByRole('button', { name: 'plugin.detailPanel.operation.moreActions' }),
    )
    const link = await screen.findByRole('menuitem', {
      name: 'plugin.detailPanel.operation.viewDetail',
    })
    expect(new URL(link.getAttribute('href')!, 'https://marketplace.example.test').pathname).toBe(
      '/plugins/test-author/test-plugin',
    )
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(onHide).toHaveBeenCalledOnce()
  })
})
