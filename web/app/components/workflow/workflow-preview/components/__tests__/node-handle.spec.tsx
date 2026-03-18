import type { NodeProps } from 'reactflow'
import type { CommonNodeType } from '@/app/components/workflow/types'
import { render, waitFor } from '@testing-library/react'
import ReactFlow, { ReactFlowProvider } from 'reactflow'
import { BlockEnum } from '@/app/components/workflow/types'
import { NodeSourceHandle, NodeTargetHandle } from '../node-handle'

const createNodeData = (overrides: Partial<CommonNodeType> = {}): CommonNodeType => ({
  type: BlockEnum.Code,
  title: 'Node',
  desc: '',
  ...overrides,
})

const TargetHandleNode = ({ id, data }: NodeProps<CommonNodeType>) => (
  <div>
    <NodeTargetHandle
      id={id}
      data={data}
      handleId="target-1"
      handleClassName="target-marker"
    />
  </div>
)

const SourceHandleNode = ({ id, data }: NodeProps<CommonNodeType>) => (
  <div>
    <NodeSourceHandle
      id={id}
      data={data}
      handleId="source-1"
      handleClassName="source-marker"
    />
  </div>
)

const renderFlowNode = (type: 'targetNode' | 'sourceNode', data: CommonNodeType) => {
  return render(
    <div style={{ width: 800, height: 600 }}>
      <ReactFlowProvider>
        <ReactFlow
          fitView
          edges={[]}
          nodes={[
            {
              id: 'node-1',
              type,
              position: { x: 0, y: 0 },
              data,
            },
          ]}
          nodeTypes={{
            targetNode: TargetHandleNode,
            sourceNode: SourceHandleNode,
          }}
        />
      </ReactFlowProvider>
    </div>,
  )
}

describe('node-handle', () => {
  // Target handle states and visibility rules.
  describe('NodeTargetHandle', () => {
    it('should hide the connection indicator when the target handle is not connected', async () => {
      const { container } = renderFlowNode('targetNode', createNodeData())

      await waitFor(() => expect(container.querySelector('.target-marker')).toBeInTheDocument())

      const handle = container.querySelector('.target-marker')

      expect(handle).toHaveAttribute('data-handleid', 'target-1')
      expect(handle).toHaveClass('after:opacity-0')
    })

    it('should merge custom classes and hide start-like nodes completely', async () => {
      const { container } = render(
        <div style={{ width: 800, height: 600 }}>
          <ReactFlowProvider>
            <ReactFlow
              fitView
              edges={[]}
              nodes={[
                {
                  id: 'node-2',
                  type: 'targetNode',
                  position: { x: 0, y: 0 },
                  data: createNodeData({ type: BlockEnum.Start }),
                },
              ]}
              nodeTypes={{
                targetNode: ({ id, data }: NodeProps<CommonNodeType>) => (
                  <div>
                    <NodeTargetHandle
                      id={id}
                      data={data}
                      handleId="target-2"
                      handleClassName="custom-target"
                    />
                  </div>
                ),
              }}
            />
          </ReactFlowProvider>
        </div>,
      )

      await waitFor(() => expect(container.querySelector('.custom-target')).toBeInTheDocument())

      const handle = container.querySelector('.custom-target')

      expect(handle).toHaveClass('opacity-0')
      expect(handle).toHaveClass('custom-target')
    })
  })

  // Source handle connection state.
  describe('NodeSourceHandle', () => {
    it('should keep the source indicator visible when the handle is connected', async () => {
      const { container } = renderFlowNode('sourceNode', createNodeData({ _connectedSourceHandleIds: ['source-1'] }))

      await waitFor(() => expect(container.querySelector('.source-marker')).toBeInTheDocument())

      const handle = container.querySelector('.source-marker')

      expect(handle).toHaveAttribute('data-handleid', 'source-1')
      expect(handle).not.toHaveClass('after:opacity-0')
    })
  })
})
