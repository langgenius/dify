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
  useNodeDataUpdate: () => ({ handleNodeDataUpdateWithSyncDraft: update }),
}))
vi.mock('@/app/components/workflow/hooks/use-edges-interactions', () => ({
  useEdgesInteractions: () => ({ handleEdgeDeleteByDeleteBranch: removeEdges }),
}))
vi.mock('@/app/components/workflow/hooks/use-workflow', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: false }),
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
  }: {
    title: ReactNode
    value: string
    onChange: (value: string) => void
    onRemove: () => void
  }) => (
    <div>
      {title}
      <textarea
        aria-label="Condition"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="button" onClick={onRemove}>
        Remove route
      </button>
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
  expect(removeEdges).toHaveBeenCalledWith('agent', 'source')
  await user.type(screen.getAllByRole('textbox', { name: 'Condition' })[0]!, 'Request approved')
  const saved = update.mock.lastCall![0].data.agent_output_routes
  await user.click(toggle)
  for (const route of saved.routes) expect(removeEdges).toHaveBeenCalledWith('agent', route.id)
  expect(removeVariable).toHaveBeenCalledWith(['agent', 'switch'])
  expect(screen.getByLabelText('Available outputs').textContent).toBe('text')
  await user.click(toggle)
  expect(screen.getAllByRole('textbox', { name: 'Condition' })[0]).toHaveValue('Request approved')
  expect(update.mock.lastCall![0].data.agent_output_routes.routes).toEqual(saved.routes)
  expect(saveHistory).toHaveBeenCalledWith('NodeChange')
})

it('removes a route by stable ID and drops switch when only one route remains', async () => {
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
  await user.click(screen.getAllByRole('button', { name: 'Remove route' })[0]!)
  expect(removeEdges).toHaveBeenCalledWith('agent', 'accepted')
  expect(removeVariable).toHaveBeenCalledWith(['agent', 'switch'])
  expect(update.mock.lastCall![0].data._targetBranches).toEqual([
    { id: 'rejected', name: 'Reject' },
  ])
  expect(screen.getByLabelText('Available outputs').textContent).toBe('text')
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
