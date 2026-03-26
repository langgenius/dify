import type { NodeProps } from 'reactflow'
import type { CommonNodeType } from '@/app/components/workflow/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { NodeRunningStatus, VarType } from '@/app/components/workflow/types'
import DefaultValue from '../default-value'
import ErrorHandleOnNode from '../error-handle-on-node'
import ErrorHandleOnPanel from '../error-handle-on-panel'
import ErrorHandleTip from '../error-handle-tip'
import ErrorHandleTypeSelector from '../error-handle-type-selector'
import FailBranchCard from '../fail-branch-card'
import { useDefaultValue, useErrorHandle } from '../hooks'
import { ErrorHandleTypeEnum } from '../types'

const { mockDocLink } = vi.hoisted(() => ({
  mockDocLink: vi.fn((path: string) => `https://docs.example.com${path}`),
}))

vi.mock('@/context/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/i18n')>()
  return {
    ...actual,
    useDocLink: () => mockDocLink,
  }
})

vi.mock('../hooks', () => ({
  useDefaultValue: vi.fn(),
  useErrorHandle: vi.fn(),
}))

vi.mock('../../node-handle', () => ({
  NodeSourceHandle: ({ handleId }: { handleId: string }) => <div className="react-flow__handle" data-handleid={handleId} />,
}))

const mockUseDefaultValue = vi.mocked(useDefaultValue)
const mockUseErrorHandle = vi.mocked(useErrorHandle)
const originalDOMMatrixReadOnly = window.DOMMatrixReadOnly

const baseData = (overrides: Partial<CommonNodeType> = {}): CommonNodeType => ({
  title: 'Code',
  desc: '',
  type: 'code' as CommonNodeType['type'],
  ...overrides,
})

const ErrorHandleNodeHarness = ({ id, data }: NodeProps<CommonNodeType>) => (
  <ErrorHandleOnNode id={id} data={data} />
)

const renderErrorHandleNode = (data: CommonNodeType) =>
  renderWorkflowFlowComponent(<div />, {
    nodes: [createNode({
      id: 'node-1',
      type: 'errorHandleNode',
      data,
    })],
    edges: [],
    reactFlowProps: {
      nodeTypes: {
        errorHandleNode: ErrorHandleNodeHarness,
      },
    },
  })

describe('error-handle path', () => {
  beforeAll(() => {
    class MockDOMMatrixReadOnly {
      inverse() {
        return this
      }

      transformPoint(point: { x: number, y: number }) {
        return point
      }
    }

    Object.defineProperty(window, 'DOMMatrixReadOnly', {
      configurable: true,
      writable: true,
      value: MockDOMMatrixReadOnly,
    })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockDocLink.mockImplementation((path: string) => `https://docs.example.com${path}`)
    mockUseDefaultValue.mockReturnValue({
      handleFormChange: vi.fn(),
    })
    mockUseErrorHandle.mockReturnValue({
      collapsed: false,
      setCollapsed: vi.fn(),
      handleErrorHandleTypeChange: vi.fn(),
    })
  })

  afterAll(() => {
    Object.defineProperty(window, 'DOMMatrixReadOnly', {
      configurable: true,
      writable: true,
      value: originalDOMMatrixReadOnly,
    })
  })

  // The error-handle leaf components should expose selectable strategies and contextual help.
  describe('Leaf Components', () => {
    it('should render the fail-branch card with the resolved learn-more link', () => {
      render(<FailBranchCard />)

      expect(screen.getByText('workflow.nodes.common.errorHandle.failBranch.customize')).toBeInTheDocument()
      expect(screen.getByRole('link')).toHaveAttribute('href', 'https://docs.example.com/use-dify/debug/error-type')
    })

    it('should render string forms and surface array forms in the default value editor', () => {
      const onFormChange = vi.fn()
      render(
        <DefaultValue
          forms={[
            { key: 'message', type: VarType.string, value: 'hello' },
            { key: 'items', type: VarType.arrayString, value: '["a"]' },
          ]}
          onFormChange={onFormChange}
        />,
      )

      fireEvent.change(screen.getByDisplayValue('hello'), { target: { value: 'updated' } })

      expect(onFormChange).toHaveBeenCalledWith({
        key: 'message',
        type: VarType.string,
        value: 'updated',
      })
      expect(screen.getByText('items')).toBeInTheDocument()
    })

    it('should toggle the selector popup and report the selected strategy', async () => {
      const user = userEvent.setup()
      const onSelected = vi.fn()
      render(
        <ErrorHandleTypeSelector
          value={ErrorHandleTypeEnum.none}
          onSelected={onSelected}
        />,
      )

      await user.click(screen.getByRole('button'))
      await user.click(screen.getByText('workflow.nodes.common.errorHandle.defaultValue.title'))

      expect(onSelected).toHaveBeenCalledWith(ErrorHandleTypeEnum.defaultValue)
    })

    it('should render the error tip only when a strategy exists', () => {
      const { rerender, container } = render(<ErrorHandleTip />)

      expect(container).toBeEmptyDOMElement()

      rerender(<ErrorHandleTip type={ErrorHandleTypeEnum.failBranch} />)
      expect(screen.getByText('workflow.nodes.common.errorHandle.failBranch.inLog')).toBeInTheDocument()

      rerender(<ErrorHandleTip type={ErrorHandleTypeEnum.defaultValue} />)
      expect(screen.getByText('workflow.nodes.common.errorHandle.defaultValue.inLog')).toBeInTheDocument()
    })
  })

  // The container components should show the correct branch card or default-value editor and propagate actions.
  describe('Containers', () => {
    it('should render the fail-branch panel body when the strategy is active', () => {
      render(
        <ErrorHandleOnPanel
          id="node-1"
          data={baseData({ error_strategy: ErrorHandleTypeEnum.failBranch })}
        />,
      )

      expect(screen.getByText('workflow.nodes.common.errorHandle.title')).toBeInTheDocument()
      expect(screen.getByText('workflow.nodes.common.errorHandle.failBranch.customize')).toBeInTheDocument()
    })

    it('should render the default-value panel body and delegate form updates', () => {
      const handleFormChange = vi.fn()
      mockUseDefaultValue.mockReturnValue({ handleFormChange })
      render(
        <ErrorHandleOnPanel
          id="node-1"
          data={baseData({
            error_strategy: ErrorHandleTypeEnum.defaultValue,
            default_value: [{ key: 'answer', type: VarType.string, value: 'draft' }],
          })}
        />,
      )

      fireEvent.change(screen.getByDisplayValue('draft'), { target: { value: 'next' } })

      expect(handleFormChange).toHaveBeenCalledWith(
        { key: 'answer', type: VarType.string, value: 'next' },
        expect.objectContaining({ error_strategy: ErrorHandleTypeEnum.defaultValue }),
      )
    })

    it('should hide the panel body when the hook reports a collapsed section', () => {
      mockUseErrorHandle.mockReturnValue({
        collapsed: true,
        setCollapsed: vi.fn(),
        handleErrorHandleTypeChange: vi.fn(),
      })

      render(
        <ErrorHandleOnPanel
          id="node-1"
          data={baseData({ error_strategy: ErrorHandleTypeEnum.failBranch })}
        />,
      )

      expect(screen.queryByText('workflow.nodes.common.errorHandle.failBranch.customize')).not.toBeInTheDocument()
    })

    it('should render the default-value node badge', () => {
      renderWorkflowFlowComponent(
        <ErrorHandleOnNode
          id="node-1"
          data={baseData({
            error_strategy: ErrorHandleTypeEnum.defaultValue,
          })}
        />,
        {
          nodes: [],
          edges: [],
        },
      )

      expect(screen.getByText('workflow.nodes.common.errorHandle.defaultValue.output')).toBeInTheDocument()
    })

    it('should render the fail-branch node badge when the node throws an exception', () => {
      const { container } = renderErrorHandleNode(baseData({
        error_strategy: ErrorHandleTypeEnum.failBranch,
        _runningStatus: NodeRunningStatus.Exception,
      }))

      return waitFor(() => {
        expect(screen.getByText('workflow.common.onFailure')).toBeInTheDocument()
        expect(screen.getByText('workflow.nodes.common.errorHandle.failBranch.title')).toBeInTheDocument()
        expect(container.querySelector('.react-flow__handle')).toHaveAttribute('data-handleid', ErrorHandleTypeEnum.failBranch)
      })
    })
  })
})
