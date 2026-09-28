import type { Edge, Node } from '../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useStoreApi } from 'reactflow'
import { WorkflowContextProvider } from '../context'
import { useDatasetsDetailStore } from '../datasets-detail-store/store'
import WorkflowWithDefaultContext from '../index'
import { useStore } from '../store'
import { BlockEnum } from '../types'
import { useWorkflowHistoryStore } from '../workflow-history-store'

const nodes: Node[] = [
  {
    id: 'node-start',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      title: 'Start',
      desc: '',
      type: BlockEnum.Start,
    },
  },
]

const edges: Edge[] = [
  {
    id: 'edge-1',
    source: 'node-start',
    target: 'node-end',
    sourceHandle: null,
    targetHandle: null,
    type: 'custom',
    data: {
      sourceType: BlockEnum.Start,
      targetType: BlockEnum.End,
    },
  },
]

const ContextConsumer = () => {
  const { store } = useWorkflowHistoryStore()
  const historyNodeCount = useStore((state) => state.workflowHistory.nodes.length)
  const datasetCount = useDatasetsDetailStore((state) => Object.keys(state.datasetsDetail).length)
  const reactFlowStore = useStoreApi()
  const advanceWorkflowHistory = () => {
    const currentHistory = store.getState()
    store.setState({
      ...currentHistory,
      nodes: [
        ...currentHistory.nodes,
        {
          ...nodes[0]!,
          id: 'node-next',
        },
      ],
    })
  }

  return (
    <>
      <div>
        {`history:${historyNodeCount}`}
        {` datasets:${datasetCount}`}
        {` reactflow:${String(!!reactFlowStore)}`}
      </div>
      <button onClick={advanceWorkflowHistory}>Advance workflow history</button>
    </>
  )
}

const HistoryAtMountConsumer = () => {
  const { store } = useWorkflowHistoryStore()
  const [nodeIds] = useState(() =>
    store
      .getState()
      .nodes.map((node) => node.id)
      .join(','),
  )

  return <div>{`history-at-mount:${nodeIds}`}</div>
}

const WorkflowRemountHarness = () => {
  const [useReplacementHistory, setUseReplacementHistory] = useState(false)
  const replacementNodes = useReplacementHistory
    ? [
        {
          ...nodes[0]!,
          id: 'node-replacement',
        },
      ]
    : nodes

  return (
    <>
      <button type="button" onClick={() => setUseReplacementHistory(true)}>
        Remount workflow
      </button>
      <WorkflowWithDefaultContext
        key={useReplacementHistory ? 'replacement' : 'initial'}
        nodes={replacementNodes}
        edges={edges}
      >
        <HistoryAtMountConsumer />
      </WorkflowWithDefaultContext>
    </>
  )
}

describe('WorkflowWithDefaultContext', () => {
  it('wires the ReactFlow, workflow history, and datasets detail providers around its children', () => {
    render(
      <WorkflowContextProvider>
        <WorkflowWithDefaultContext nodes={nodes} edges={edges}>
          <ContextConsumer />
        </WorkflowWithDefaultContext>
      </WorkflowContextProvider>,
    )

    expect(screen.getByText('history:1 datasets:0 reactflow:true')).toBeInTheDocument()
  })

  it('keeps its children mounted when workflow history advances after initialization', async () => {
    const user = userEvent.setup()

    render(
      <WorkflowContextProvider>
        <WorkflowWithDefaultContext nodes={nodes} edges={edges}>
          <ContextConsumer />
        </WorkflowWithDefaultContext>
      </WorkflowContextProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Advance workflow history' }))

    expect(screen.getByText('history:2 datasets:0 reactflow:true')).toBeInTheDocument()
  })

  it('initializes new history before mounting children again in the same workflow store', async () => {
    const user = userEvent.setup()

    render(
      <WorkflowContextProvider>
        <WorkflowRemountHarness />
      </WorkflowContextProvider>,
    )

    expect(screen.getByText('history-at-mount:node-start')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remount workflow' }))

    expect(screen.getByText('history-at-mount:node-replacement')).toBeInTheDocument()
  })
})
