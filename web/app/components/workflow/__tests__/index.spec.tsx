import type { Edge, Node } from '../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useStoreApi } from 'reactflow'
import { WorkflowContextProvider } from '../context'
import { useDatasetsDetailStore } from '../datasets-detail-store/store'
import WorkflowWithDefaultContext from '../index'
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
  const datasetCount = useDatasetsDetailStore((state) => Object.keys(state.datasetsDetail).length)
  const reactFlowStore = useStoreApi()

  return (
    <div>
      {`history:${store.getState().nodes.length}`}
      {` datasets:${datasetCount}`}
      {` reactflow:${String(!!reactFlowStore)}`}
    </div>
  )
}

const HistoryUpdatingConsumer = () => {
  const { store } = useWorkflowHistoryStore()

  return (
    <button
      onClick={() => {
        const currentHistory = store.getState()
        store.setState({
          ...currentHistory,
          nodes: [
            ...currentHistory.nodes,
            {
              ...nodes[0]!,
              id: 'node-added-after-mount',
            },
          ],
        })
      }}
    >
      Update workflow history
    </button>
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
      <button onClick={() => setUseReplacementHistory(true)}>Remount workflow</button>
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

  it('keeps the canvas children mounted when workflow history changes', async () => {
    const user = userEvent.setup()

    render(
      <WorkflowContextProvider>
        <WorkflowWithDefaultContext nodes={nodes} edges={edges}>
          <HistoryUpdatingConsumer />
        </WorkflowWithDefaultContext>
      </WorkflowContextProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Update workflow history' }))

    expect(screen.getByRole('button', { name: 'Update workflow history' })).toBeInTheDocument()
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
