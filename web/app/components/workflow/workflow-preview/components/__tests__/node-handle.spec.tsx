import type { NodeProps } from 'reactflow'
import type { CommonNodeType } from '@/app/components/workflow/types'
import { waitFor } from '@testing-library/react'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
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

const renderFlowNode = (type: 'targetNode' | 'sourceNode', data: CommonNodeType) =>
  renderWorkflowFlowComponent(<div />, {
    nodes: [createNode({
      id: 'node-1',
      type,
      data,
    })],
    edges: [],
    reactFlowProps: {
      nodeTypes: {
        targetNode: TargetHandleNode,
        sourceNode: SourceHandleNode,
      },
    },
  })

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
      const { container } = renderWorkflowFlowComponent(<div />, {
        nodes: [createNode({
          id: 'node-2',
          type: 'targetNode',
          data: createNodeData({ type: BlockEnum.Start }),
        })],
        edges: [],
        reactFlowProps: {
          nodeTypes: {
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
          },
        },
      })

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
