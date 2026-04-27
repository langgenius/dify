import type { Node } from '../types'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { useNodes } from 'reactflow'
import { useNodesInteractions } from '../hooks'
import { createIterationNode, createNode } from './fixtures'
import { renderWorkflowFlowComponent } from './workflow-test-env'

let latestNodes: Node[] = []

const DeleteProbe = () => {
  const { handleNodesDelete } = useNodesInteractions()
  latestNodes = useNodes() as Node[]

  return (
    <button type="button" onClick={() => handleNodesDelete()}>
      delete
    </button>
  )
}

const hooksStoreProps = {
  doSyncWorkflowDraft: vi.fn().mockResolvedValue(undefined),
}

describe('Nodes delete confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    latestNodes = []
  })

  it('should require confirm when deleting bundled iteration with other nodes', async () => {
    const nodes = [
      createIterationNode({
        id: 'iter-1',
        data: {
          _isBundled: true,
        },
      }),
      createNode({
        id: 'iter-child-1',
        parentId: 'iter-1',
        data: {
          _isBundled: true,
        },
      }),
      createNode({
        id: 'iter-child-2',
        parentId: 'iter-1',
        data: {
          _isBundled: true,
        },
      }),
      createNode({
        id: 'normal-1',
        data: {
          _isBundled: true,
        },
      }),
    ]

    const { store } = renderWorkflowFlowComponent(
      <DeleteProbe />,
      {
        nodes,
        historyStore: { nodes, edges: [] },
        hooksStoreProps,
      },
    )

    fireEvent.click(screen.getByRole('button', { name: 'delete' }))

    expect(store.getState().showConfirm).toBeDefined()
    expect(latestNodes).toHaveLength(4)

    act(() => {
      store.getState().showConfirm?.onConfirm()
    })

    await waitFor(() => {
      expect(latestNodes).toHaveLength(0)
    })
    expect(store.getState().showConfirm).toBeUndefined()
  })
})
