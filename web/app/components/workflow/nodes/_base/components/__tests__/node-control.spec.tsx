import type { CommonNodeType } from '../../../../types'
import type { ToolNodeType } from '@/app/components/workflow/nodes/tool/types'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNodes } from 'reactflow'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import { CollectionType } from '@/app/components/tools/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper, seedAppDslVersion } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { seedToolProviders } from '@/test/console/tool-providers'
import { renderWorkflowFlowComponent } from '../../../../__tests__/workflow-test-env'
import { fullWorkflowAccessControl } from '../../../../hooks-store'
import { BlockEnum, NodeRunningStatus } from '../../../../types'
import NodeControl from '../node-control'

function SelectedNode() {
  const selected = useNodes<CommonNodeType>().find((node) => node.data.selected)
  return <output aria-label="Selected node">{selected?.id}</output>
}
const renderControl = ({
  data = {},
  canRun = true,
  readonly = false,
  pluginInstallLocked = false,
  tools = [],
}: {
  data?: Partial<CommonNodeType> & Partial<ToolNodeType>
  canRun?: boolean
  readonly?: boolean
  pluginInstallLocked?: boolean
  tools?: ReturnType<typeof createToolProviderFixture>[]
} = {}) => {
  const { queryClient } = createConsoleQueryWrapper()
  seedAppDslVersion(queryClient)
  seedToolProviders(queryClient, { builtInTools: tools, customTools: [], workflowTools: [] })
  queryClient.setQueryData(
    consoleQuery.workspaces.current.defaultModel.get.queryKey({
      input: { query: { model_type: 'llm' } },
    }),
    { data: null },
  )
  const payload: CommonNodeType = { type: BlockEnum.Code, title: 'Code', desc: '', ...data }
  return renderWorkflowFlowComponent(
    <>
      <NodeControl id="node-1" data={payload} pluginInstallLocked={pluginInstallLocked} />
      <SelectedNode />
    </>,
    {
      queryClient,
      nodes: [{ id: 'node-1', position: { x: 0, y: 0 }, data: payload }],
      initialStoreState: { canvasReadOnly: readonly },
      hooksStoreProps: { accessControl: { ...fullWorkflowAccessControl, canRun } },
    },
  )
}

describe('NodeControl', () => {
  it.each([
    { status: undefined, label: 'workflow.panel.runThisStep', action: 'run' },
    {
      status: NodeRunningStatus.Running,
      label: 'workflowDebug.debug.variableInspect.trigger.stop',
      action: 'stop',
    },
  ])(
    'selects the node and requests $action using real workflow permissions',
    async ({ status, label, action }) => {
      const user = userEvent.setup()
      const { store } = renderControl({ data: { _singleRunningStatus: status } })
      await user.click(screen.getByRole('button', { name: label }))
      expect(store.getState().initShowLastRunTab).toBe(true)
      expect(store.getState().pendingSingleRun).toEqual({ nodeId: 'node-1', action })
      expect(screen.getByRole('status', { name: 'Selected node' })).toHaveTextContent('node-1')
    },
  )

  it.each([
    { reason: 'read-only canvas', readonly: true },
    { reason: 'missing run permission', canRun: false },
    { reason: 'unsupported node type', data: { type: BlockEnum.End } },
  ])('hides execution controls for $reason', (options) => {
    renderControl(options)
    expect(
      screen.queryByRole('button', { name: 'workflow.panel.runThisStep' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.more' })).toBeInTheDocument()
  })

  it('allows opening node actions while plugin installation is locked', async () => {
    const user = userEvent.setup()
    renderControl({ pluginInstallLocked: true, data: { selected: true } })
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    expect(await screen.findByRole('menu')).toBeVisible()
  })

  it('blocks an unconfigured App user test run and enables it after adding a connection', async () => {
    const user = userEvent.setup()
    const provider = createToolProviderFixture({
      id: 'provider-id',
      name: 'test-provider',
      allow_delete: true,
      is_team_authorization: false,
    })
    const { store } = renderControl({
      tools: [provider],
      data: {
        type: BlockEnum.Tool,
        provider_type: CollectionType.builtIn,
        provider_id: provider.id,
        provider_name: provider.name,
        tool_name: 'test-tool',
        tool_label: 'Test tool',
        tool_parameters: {},
        tool_configurations: {},
      },
    })
    const draft = {
      oauthEnabled: false,
      apiKeyEnabled: true,
      description: 'Connect app users',
      testConnection: { connections: [] },
    }
    act(() => {
      store.getState().setNodeAppUserAuthDraft('node-1', provider.name, provider.id, draft)
      store
        .getState()
        .setNodeAuthorizationTab('node-1', provider.name, provider.id, 'app-user-auth')
    })
    const run = screen.getByRole('button', { name: 'workflow.panel.runThisStep' })
    expect(run).toHaveAttribute('aria-disabled', 'true')
    await user.click(run)
    expect(store.getState().pendingSingleRun).toBeUndefined()
    expect(store.getState().initShowLastRunTab).toBe(false)
    expect(screen.getByRole('status', { name: 'Selected node' })).toBeEmptyDOMElement()

    await user.keyboard('{Escape}')
    act(() =>
      store.getState().setNodeAppUserAuthDraft('node-1', provider.name, provider.id, {
        ...draft,
        testConnection: {
          connections: [
            {
              id: 'test-key',
              name: 'Test key',
              method: CredentialTypeEnum.API_KEY,
              subtitle: '•••• 1234',
            },
          ],
          selectedId: 'test-key',
        },
      }),
    )
    await user.click(screen.getByRole('button', { name: 'workflow.panel.runThisStep' }))
    expect(store.getState().pendingSingleRun).toEqual({ nodeId: 'node-1', action: 'run' })
    expect(screen.getByRole('status', { name: 'Selected node' })).toHaveTextContent('node-1')
  })

  it('keeps stop available when App user test connections have been removed', async () => {
    const user = userEvent.setup()
    const provider = createToolProviderFixture({
      id: 'provider-id',
      name: 'test-provider',
      allow_delete: true,
      is_team_authorization: false,
    })
    const { store } = renderControl({
      tools: [provider],
      data: {
        type: BlockEnum.Tool,
        provider_type: CollectionType.builtIn,
        provider_id: provider.id,
        _singleRunningStatus: NodeRunningStatus.Running,
      },
    })
    act(() => {
      store.getState().setNodeAppUserAuthDraft('node-1', provider.name, provider.id, {
        oauthEnabled: false,
        apiKeyEnabled: true,
        description: 'Connect app users',
        testConnection: { connections: [] },
      })
      store
        .getState()
        .setNodeAuthorizationTab('node-1', provider.name, provider.id, 'app-user-auth')
    })
    const stop = screen.getByRole('button', {
      name: 'workflowDebug.debug.variableInspect.trigger.stop',
    })
    expect(stop).not.toHaveAttribute('aria-disabled', 'true')
    await user.click(stop)
    expect(store.getState().pendingSingleRun).toEqual({ nodeId: 'node-1', action: 'stop' })
  })
})
