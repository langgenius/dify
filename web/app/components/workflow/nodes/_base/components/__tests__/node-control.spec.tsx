import type { CommonNodeType } from '../../../../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNodes } from 'reactflow'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper, seedAppDslVersion } from '@/test/console/query-data'
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
}: {
  data?: Partial<CommonNodeType>
  canRun?: boolean
  readonly?: boolean
  pluginInstallLocked?: boolean
} = {}) => {
  const { queryClient } = createConsoleQueryWrapper()
  seedAppDslVersion(queryClient)
  seedToolProviders(queryClient, { builtInTools: [], customTools: [], workflowTools: [] })
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
})
