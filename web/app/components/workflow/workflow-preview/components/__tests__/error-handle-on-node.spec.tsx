import type { NodeProps } from 'reactflow'
import type { CommonNodeType } from '@/app/components/workflow/types'
import { screen, waitFor } from '@testing-library/react'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { ErrorHandleTypeEnum } from '@/app/components/workflow/nodes/_base/components/error-handle/types'
import { BlockEnum, NodeRunningStatus } from '@/app/components/workflow/types'
import ErrorHandleOnNode from '../error-handle-on-node'

const createNodeData = (overrides: Partial<CommonNodeType> = {}): CommonNodeType => ({
  type: BlockEnum.Code,
  title: 'Node',
  desc: '',
  ...overrides,
})

const ErrorNode = ({ id, data }: NodeProps<CommonNodeType>) => (
  <div>
    <ErrorHandleOnNode id={id} data={data} />
  </div>
)

const renderErrorNode = (data: CommonNodeType) =>
  renderWorkflowFlowComponent(<div />, {
    nodes: [createNode({
      id: 'node-1',
      type: 'errorNode',
      data,
    })],
    edges: [],
    reactFlowProps: {
      nodeTypes: { errorNode: ErrorNode },
    },
  })

describe('ErrorHandleOnNode', () => {
  // Empty and default-value states.
  describe('Rendering', () => {
    it('should render nothing when the node has no error strategy', () => {
      const { container } = renderErrorNode(createNodeData())

      expect(screen.queryByText('workflow.common.onFailure')).not.toBeInTheDocument()
      expect(container.querySelector('.react-flow__handle')).not.toBeInTheDocument()
    })

    it('should render the default-value label', async () => {
      renderErrorNode(createNodeData({ error_strategy: ErrorHandleTypeEnum.defaultValue }))

      await waitFor(() => expect(screen.getByText('workflow.common.onFailure')).toBeInTheDocument())
      expect(screen.getByText('workflow.common.onFailure')).toBeInTheDocument()
      expect(screen.getByText('workflow.nodes.common.errorHandle.defaultValue.output')).toBeInTheDocument()
    })
  })

  // Fail-branch behavior and warning styling.
  describe('Effects', () => {
    it('should render the fail-branch source handle', async () => {
      const { container } = renderErrorNode(createNodeData({ error_strategy: ErrorHandleTypeEnum.failBranch }))

      await waitFor(() => expect(screen.getByText('workflow.nodes.common.errorHandle.failBranch.title')).toBeInTheDocument())
      expect(screen.getByText('workflow.nodes.common.errorHandle.failBranch.title')).toBeInTheDocument()
      expect(container.querySelector('.react-flow__handle')).toHaveAttribute('data-handleid', ErrorHandleTypeEnum.failBranch)
    })

    it('should add warning styles when the node is in exception status', async () => {
      const { container } = renderErrorNode(createNodeData({
        error_strategy: ErrorHandleTypeEnum.defaultValue,
        _runningStatus: NodeRunningStatus.Exception,
      }))

      await waitFor(() => expect(container.querySelector('.bg-state-warning-hover')).toBeInTheDocument())
      expect(container.querySelector('.bg-state-warning-hover')).toHaveClass('border-components-badge-status-light-warning-halo')
      expect(container.querySelector('.text-text-warning')).toBeInTheDocument()
    })
  })
})
