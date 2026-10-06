import type { ReactNode } from 'react'
import type { AgentV2NodeType } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { ErrorHandleTypeEnum } from '../../../_base/components/error-handle/types'
import { getAgentV2DeclaredOutputs } from '../../output-variables'
import { AgentOutputRoutes } from '../agent-output-routes'

const { removeEdges, removeVariable, saveHistory, update } = vi.hoisted(() => ({
  removeEdges: vi.fn(),
  removeVariable: vi.fn(),
  saveHistory: vi.fn(),
  update: vi.fn(),
}))
vi.mock('@/app/components/workflow/hooks/use-node-data-update', () => ({
  useNodeDataUpdate: () => ({ handleNodeDataUpdate: update }),
}))
vi.mock('@/app/components/workflow/hooks/use-edges-interactions', () => ({
  useEdgesInteractions: () => ({ removeBranchEdges: removeEdges }),
}))
vi.mock('@/app/components/workflow/hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({ handleSyncWorkflowDraft: vi.fn() }),
}))
vi.mock('@/app/components/workflow/hooks/use-workflow', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: false, getNodesReadOnly: () => false }),
  useWorkflow: () => ({ removeUsedVarInNodes: removeVariable }),
}))
vi.mock('@/app/components/workflow/hooks/use-workflow-history', () => ({
  useWorkflowHistory: () => ({ saveStateToHistory: saveHistory }),
  WorkflowHistoryEvent: { NodeChange: 'NodeChange' },
}))
vi.mock('../../../_base/hooks/use-available-var-list', () => ({
  default: () => ({ availableVars: [], availableNodesWithParent: [] }),
}))
vi.mock('react-sortablejs', () => ({
  ReactSortable: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
// The rich text editor's own tests cover variable tokens; this boundary exercises
// the route editor's persisted condition, label, and list mutations.
vi.mock('../../../_base/components/prompt/editor', () => ({
  default: ({
    title,
    value,
    onChange,
    onRemove,
    showRemove,
  }: {
    title: ReactNode
    value: string
    onChange: (value: string) => void
    onRemove: () => void
    showRemove?: boolean
  }) => (
    <div>
      {title}
      <textarea
        aria-label="Condition"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {showRemove && (
        <button type="button" onClick={onRemove}>
          Remove route
        </button>
      )}
    </div>
  ),
}))

function Harness({
  initial,
  errorStrategy,
}: {
  initial?: AgentV2NodeType['agent_output_routes']
  errorStrategy?: ErrorHandleTypeEnum
}) {
  const [data, setData] = useState<AgentV2NodeType>({
    type: BlockEnum.AgentV2,
    title: 'Agent',
    desc: '',
    version: '2',
    agent_node_kind: 'dify_agent',
    agent_output_routes: initial,
    error_strategy: errorStrategy,
    default_value:
      errorStrategy === ErrorHandleTypeEnum.defaultValue
        ? [{ key: 'text', type: VarType.string, value: 'fallback' }]
        : undefined,
  })
  update.mockImplementation(({ data: changed }: { data: Partial<AgentV2NodeType> }) =>
    setData((data) => ({ ...data, ...changed })),
  )
  return (
    <>
      <AgentOutputRoutes id="agent" data={data} />
      <output aria-label="Available outputs">
        {getAgentV2DeclaredOutputs(data)
          .map((output) => output.name)
          .join(',')}
      </output>
    </>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

it('enables two routes, preserves edited conditions through toggles, and changes success handles', async () => {
  const user = userEvent.setup()
  render(<Harness initial={{ enabled: false, routes: [] }} />)
  const toggle = screen.getByRole('switch', { name: 'workflow.nodes.agent.outputRoutes.title' })
  await user.click(toggle)
  expect(screen.getAllByRole('textbox', { name: 'Condition' })).toHaveLength(2)
  expect(screen.getByLabelText('Available outputs')).toHaveTextContent('text,switch')
  expect(removeEdges).toHaveBeenCalledWith('agent', ['source'])
  await user.type(screen.getAllByRole('textbox', { name: 'Condition' })[0]!, 'Request approved')
  const saved = update.mock.lastCall![0].data.agent_output_routes
  await user.click(toggle)
  expect(removeEdges).toHaveBeenCalledWith(
    'agent',
    saved.routes.map((route: { id: string }) => route.id),
  )
  expect(removeVariable).toHaveBeenCalledWith(['agent', 'switch'])
  expect(screen.getByLabelText('Available outputs').textContent).toBe('text')
  await user.click(toggle)
  expect(screen.getAllByRole('textbox', { name: 'Condition' })[0]).toHaveValue('Request approved')
  expect(update.mock.lastCall![0].data.agent_output_routes.routes).toEqual(saved.routes)
  expect(saveHistory).toHaveBeenCalledWith('NodeChange')
})

it('removes a route by stable ID and keeps at least two routes with switch available', async () => {
  const user = userEvent.setup()
  render(
    <Harness
      initial={{
        enabled: true,
        routes: [
          { id: 'accepted', name: 'Accept' },
          { id: 'rejected', name: 'Reject' },
          { id: 'deferred', name: 'Defer' },
        ],
      }}
    />,
  )
  await user.click(screen.getAllByRole('button', { name: 'Remove route' })[0]!)
  expect(removeEdges).toHaveBeenCalledWith('agent', ['accepted'])
  expect(removeVariable).not.toHaveBeenCalled()
  expect(update.mock.lastCall![0].data._targetBranches).toEqual([
    { id: 'rejected', name: 'Reject' },
    { id: 'deferred', name: 'Defer' },
  ])
  expect(screen.getByLabelText('Available outputs').textContent).toBe('text,switch')
  expect(screen.getAllByRole('textbox', { name: 'Condition' })).toHaveLength(2)
  expect(screen.queryByRole('button', { name: 'Remove route' })).not.toBeInTheDocument()
})

it('collapses routes independently of their enabled state and keeps one title', async () => {
  const user = userEvent.setup()
  render(
    <Harness
      initial={{
        enabled: true,
        routes: [
          { id: 'accepted', name: 'Accept' },
          { id: 'rejected', name: 'Reject' },
        ],
      }}
    />,
  )
  const title = 'workflow.nodes.agent.outputRoutes.title'
  const disclosure = screen.getByRole('button', { name: new RegExp(title) })
  const toggle = screen.getByRole('switch', { name: title })
  expect(screen.getAllByText(title, { exact: true })).toHaveLength(1)
  expect(disclosure).toHaveAttribute('aria-expanded', 'true')

  await user.click(disclosure)
  expect(disclosure).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('textbox', { name: 'Condition' })).not.toBeInTheDocument()
  expect(toggle).toBeChecked()
  expect(update).not.toHaveBeenCalled()
  expect(removeEdges).not.toHaveBeenCalled()

  await user.click(disclosure)
  expect(screen.getAllByRole('textbox', { name: 'Condition' })[0]).toHaveValue('Accept')
  await user.click(toggle)
  expect(disclosure).toHaveAttribute('aria-disabled', 'true')
  await user.click(disclosure)
  expect(screen.queryByRole('textbox', { name: 'Condition' })).not.toBeInTheDocument()
  expect(screen.queryByText('workflowAgent.nodes.agent.outputRoutes.add')).not.toBeInTheDocument()
  await user.click(toggle)
  expect(disclosure).not.toHaveAttribute('aria-disabled', 'true')
  expect(disclosure).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getAllByRole('textbox', { name: 'Condition' })).toHaveLength(2)
})

it('keeps a saved disabled route and adds only the missing route when enabling', async () => {
  const user = userEvent.setup()
  const saved = { id: 'accepted', name: 'Accept', label: 'Accepted' }
  render(<Harness initial={{ enabled: false, routes: [saved] }} />)

  await user.click(screen.getByRole('switch', { name: 'workflow.nodes.agent.outputRoutes.title' }))

  const routes = update.mock.lastCall![0].data.agent_output_routes.routes
  expect(routes).toHaveLength(2)
  expect(routes[0]).toEqual(saved)
  expect(routes[1]).toMatchObject({ id: expect.any(String), name: '' })
  expect(routes[1].id).not.toBe(saved.id)
  expect(screen.getAllByRole('textbox', { name: 'Condition' })[0]).toHaveValue('Accept')
  expect(screen.queryByRole('button', { name: 'Remove route' })).not.toBeInTheDocument()
})

it('clears node-level default values when enabling routes', async () => {
  const user = userEvent.setup()
  render(<Harness errorStrategy={ErrorHandleTypeEnum.defaultValue} />)
  await user.click(screen.getByRole('switch', { name: 'workflow.nodes.agent.outputRoutes.title' }))
  expect(update.mock.lastCall![0].data).toMatchObject({
    agent_output_routes: { enabled: true },
    error_strategy: undefined,
    default_value: undefined,
  })
})
