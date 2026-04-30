import type { Edge, Node } from '../types'
import { render, screen } from '@testing-library/react'
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
  const datasetCount = useDatasetsDetailStore(state => Object.keys(state.datasetsDetail).length)
  const reactFlowStore = useStoreApi()

  return (
    <div>
      {`history:${store.getState().nodes.length}`}
      {` datasets:${datasetCount}`}
      {` reactflow:${String(!!reactFlowStore)}`}
    </div>
  )
}

describe('WorkflowWithDefaultContext', () => {
  it('wires the ReactFlow, workflow history, and datasets detail providers around its children', () => {
    render(
      <WorkflowContextProvider>
        <WorkflowWithDefaultContext
          nodes={nodes}
          edges={edges}
        >
          <ContextConsumer />
        </WorkflowWithDefaultContext>
      </WorkflowContextProvider>,
    )

    expect(
      screen.getByText('history:1 datasets:0 reactflow:true'),
    ).toBeInTheDocument()
  })
})
