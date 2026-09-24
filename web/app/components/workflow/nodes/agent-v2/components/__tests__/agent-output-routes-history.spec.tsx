import type { ReactNode } from 'react'
import type { AgentV2NodeType } from '../../types'
import type { Edge, Node } from '@/app/components/workflow/types'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEdges, useNodes } from 'reactflow'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { useNodesInteractions } from '@/app/components/workflow/hooks/use-nodes-interactions'
import { BlockEnum } from '@/app/components/workflow/types'
import { AgentOutputRoutes } from '../agent-output-routes'

vi.mock('../../../_base/hooks/use-available-var-list', () => ({
  default: () => ({ availableVars: [], availableNodesWithParent: [] }),
}))

vi.mock('../../hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks')>()),
  useCreateInlineAgentBinding: () => ({ createInlineAgentBinding: vi.fn() }),
}))

// Route history depends on the list mutation, not the rich text editor's token handling.
vi.mock('../../../_base/components/prompt/editor', () => ({
  default: ({
    title,
    value,
    onRemove,
    showRemove,
  }: {
    title: ReactNode
    value: string
    onRemove: () => void
    showRemove?: boolean
  }) => (
    <div>
      {title}
      <textarea aria-label="Condition" value={value} readOnly />
      {showRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${value}`}>
          Remove route
        </button>
      )}
    </div>
  ),
}))

function HistoryEditor() {
  const nodes = useNodes<AgentV2NodeType>()
  const edges = useEdges()
  const { handleHistoryBack } = useNodesInteractions()
  const agent = nodes.find((node) => node.id === 'agent')
  if (!agent) return null

  return (
    <>
      <AgentOutputRoutes id={agent.id} data={agent.data} />
      <button type="button" onClick={handleHistoryBack}>
        Undo
      </button>
      <output aria-label="Connections">{edges.map((edge) => edge.id).join(',')}</output>
    </>
  )
}

function renderHistoryEditor({ connected = false }: { connected?: boolean } = {}) {
  const routes = [
    { id: 'accepted', name: 'Accept', label: 'Accepted' },
    { id: 'rejected', name: 'Reject', label: 'Rejected' },
    ...(connected ? [{ id: 'deferred', name: 'Defer', label: 'Deferred' }] : []),
  ]
  const agent: Node<AgentV2NodeType> = {
    id: 'agent',
    type: 'default',
    position: { x: 0, y: 0 },
    data: {
      type: BlockEnum.AgentV2,
      title: 'Agent',
      desc: '',
      version: '2',
      agent_node_kind: 'dify_agent',
      agent_output_routes: { enabled: true, routes },
      _targetBranches: routes,
      _connectedSourceHandleIds: connected ? ['accepted'] : [],
    },
  }
  const nodes: Node[] = [agent]
  const edges: Edge[] = []
  if (connected) {
    nodes.push({
      id: 'end',
      type: 'default',
      position: { x: 300, y: 0 },
      data: {
        type: BlockEnum.End,
        title: 'End',
        desc: '',
        _connectedTargetHandleIds: ['target'],
      },
    })
    edges.push({
      id: 'accepted-result',
      source: 'agent',
      sourceHandle: 'accepted',
      target: 'end',
      targetHandle: 'target',
      data: { sourceType: BlockEnum.AgentV2, targetType: BlockEnum.End },
    })
  }
  return renderWorkflowFlowComponent(<HistoryEditor />, {
    nodes,
    edges,
    historyStore: { nodes, edges },
    hooksStoreProps: { doSyncWorkflowDraft: vi.fn() },
  })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('restores enabled routes with one undo when disabling them removes no edges', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  renderHistoryEditor()
  const toggle = screen.getByRole('switch', { name: 'workflow.nodes.agent.outputRoutes.title' })

  await user.click(toggle)
  expect(toggle).not.toBeChecked()
  await act(() => vi.advanceTimersByTimeAsync(500))
  await user.click(screen.getByRole('button', { name: 'Undo' }))

  expect(toggle).toBeChecked()
  expect(screen.getAllByRole('textbox', { name: 'Condition' })).toHaveLength(2)
})

it('restores a deleted route and its connection with one undo', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  renderHistoryEditor({ connected: true })

  await user.click(screen.getByRole('button', { name: 'Remove Accept' }))
  expect(screen.queryByRole('button', { name: 'Accepted' })).not.toBeInTheDocument()
  expect(screen.getByLabelText('Connections')).toBeEmptyDOMElement()
  await act(() => vi.advanceTimersByTimeAsync(500))
  await user.click(screen.getByRole('button', { name: 'Undo' }))

  expect(screen.getByRole('button', { name: 'Accepted' })).toBeVisible()
  expect(screen.getAllByRole('textbox', { name: 'Condition' })).toHaveLength(3)
  expect(screen.getByLabelText('Connections')).toHaveTextContent('accepted-result')
})
