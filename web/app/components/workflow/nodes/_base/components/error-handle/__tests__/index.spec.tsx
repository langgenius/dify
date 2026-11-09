import type { ReactElement } from 'react'
import type { NodeProps } from 'reactflow'
import type { CommonNodeType } from '@/app/components/workflow/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider, useEdges, useNodes } from 'reactflow'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import {
  renderWorkflowComponent,
  renderWorkflowFlowComponent,
} from '@/app/components/workflow/__tests__/workflow-test-env'
import { NodeRunningStatus, VarType } from '@/app/components/workflow/types'
import DefaultValue from '../default-value'
import ErrorHandleOnNode from '../error-handle-on-node'
import ErrorHandleOnPanel from '../error-handle-on-panel'
import ErrorHandleTip from '../error-handle-tip'
import ErrorHandleTypeSelector from '../error-handle-type-selector'
import FailBranchCard from '../fail-branch-card'
import { ErrorHandleTypeEnum } from '../types'

const render = (ui: ReactElement) => {
  const result = renderWorkflowComponent(<ReactFlowProvider>{ui}</ReactFlowProvider>)
  return {
    ...result,
    rerender: (next: ReactElement) =>
      result.rerender(<ReactFlowProvider>{next}</ReactFlowProvider>),
  }
}

// Port connections and the block picker have their own canvas integration tests.
vi.mock('../../node-handle', () => ({ NodeSourceHandle: () => null }))

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
    nodes: [
      createNode({
        id: 'node-1',
        type: 'errorHandleNode',
        data,
      }),
    ],
    edges: [],
    reactFlowProps: {
      nodeTypes: {
        errorHandleNode: ErrorHandleNodeHarness,
      },
    },
  })

function ErrorPanel() {
  const nodes = useNodes<CommonNodeType>()
  const edges = useEdges()
  const node = nodes.find((node) => node.id === 'node-1')
  if (!node) return null
  return (
    <>
      <ErrorHandleOnPanel id={node.id} data={node.data} />
      <output aria-label="Saved defaults">{JSON.stringify(node.data.default_value ?? null)}</output>
      <output aria-label="Saved error strategy">{node.data.error_strategy ?? 'stop'}</output>
      <output aria-label="Canvas edges">{edges.map((edge) => edge.id).join(',')}</output>
    </>
  )
}

function renderPanel(data: CommonNodeType) {
  return renderWorkflowFlowComponent(<ErrorPanel />, {
    nodes: [
      createNode({ id: 'node-1', data }),
      createNode({ id: 'target' }),
      createNode({ id: 'other' }),
    ],
    edges: [
      createEdge({
        id: 'failure',
        source: 'node-1',
        target: 'target',
        sourceHandle: ErrorHandleTypeEnum.failBranch,
      }),
      createEdge({ id: 'success', source: 'node-1', target: 'other', sourceHandle: 'source' }),
      createEdge({ id: 'unrelated', source: 'other', target: 'target' }),
    ],
    hooksStoreProps: { doSyncWorkflowDraft: async () => undefined },
  })
}

describe('error-handle path', () => {
  beforeAll(() => {
    class MockDOMMatrixReadOnly {
      inverse() {
        return this
      }

      transformPoint(point: { x: number; y: number }) {
        return point
      }
    }

    Object.defineProperty(window, 'DOMMatrixReadOnly', {
      configurable: true,
      writable: true,
      value: MockDOMMatrixReadOnly,
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

      expect(
        screen.getByText('workflow.nodes.common.errorHandle.failBranch.customize'),
      ).toBeInTheDocument()
      expect(screen.getByRole('link')).toHaveAttribute(
        'href',
        expect.stringContaining('/use-dify/debug/error-type'),
      )
    })

    it('should edit a labeled string default and preserve the array editor', async () => {
      const user = userEvent.setup()
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

      const input = screen.getByRole('textbox', { name: 'message' })
      await user.click(screen.getByText('message'))
      expect(input).toHaveFocus()
      await user.type(input, '!')

      expect(onFormChange).toHaveBeenCalledWith({
        key: 'message',
        type: VarType.string,
        value: 'hello!',
      })
      expect(screen.getByText('items')).toBeInTheDocument()
    })

    it('should report a numeric default as a string to the workflow owner', async () => {
      const user = userEvent.setup()
      const onFormChange = vi.fn()
      render(
        <DefaultValue
          forms={[{ key: 'count', type: VarType.number, value: 12 }]}
          onFormChange={onFormChange}
        />,
      )

      await user.type(screen.getByRole('spinbutton', { name: 'count' }), '3')

      expect(onFormChange).toHaveBeenLastCalledWith({
        key: 'count',
        type: VarType.number,
        value: '123',
      })
    })

    it('should toggle the selector popup and report the selected strategy', async () => {
      const user = userEvent.setup()
      const onSelected = vi.fn()
      render(<ErrorHandleTypeSelector value={ErrorHandleTypeEnum.none} onSelected={onSelected} />)

      await user.click(screen.getByRole('button'))
      await user.click(screen.getByText('workflow.nodes.common.errorHandle.defaultValue.title'))

      expect(onSelected.mock.calls[0]?.[0]).toBe(ErrorHandleTypeEnum.defaultValue)
    })

    it('offers only stop and failure-branch strategies when default values are unsupported', async () => {
      const user = userEvent.setup()
      render(
        <ErrorHandleTypeSelector
          value={ErrorHandleTypeEnum.none}
          onSelected={vi.fn()}
          allowDefaultValue={false}
        />,
      )
      await user.click(screen.getByRole('button'))
      expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
        expect.stringContaining('workflow.nodes.common.errorHandle.none.title'),
        expect.stringContaining('workflow.nodes.common.errorHandle.failBranch.title'),
      ])
    })

    it('should render the error tip only when a strategy exists', () => {
      const { rerender, container } = render(<ErrorHandleTip />)

      expect(container).toBeEmptyDOMElement()

      rerender(<ErrorHandleTip type={ErrorHandleTypeEnum.failBranch} />)
      expect(
        screen.getByText('workflow.nodes.common.errorHandle.failBranch.inLog'),
      ).toBeInTheDocument()

      rerender(<ErrorHandleTip type={ErrorHandleTypeEnum.defaultValue} />)
      expect(
        screen.getByText('workflow.nodes.common.errorHandle.defaultValue.inLog'),
      ).toBeInTheDocument()
    })
  })

  // The container components should show the correct branch card or default-value editor and propagate actions.
  describe('Containers', () => {
    it('should render the fail-branch panel body when the strategy is active', () => {
      renderPanel(baseData({ error_strategy: ErrorHandleTypeEnum.failBranch }))

      expect(screen.getByText('workflow.nodes.common.errorHandle.title')).toBeInTheDocument()
      expect(
        screen.getByText('workflow.nodes.common.errorHandle.failBranch.customize'),
      ).toBeInTheDocument()
    })

    it('updates the edited default while preserving the other node defaults', async () => {
      const user = userEvent.setup()
      const data = baseData({
        error_strategy: ErrorHandleTypeEnum.defaultValue,
        default_value: [
          { key: 'answer', type: VarType.string, value: 'draft' },
          { key: 'count', type: VarType.number, value: 7 },
        ],
      })
      renderPanel(data)

      const answer = screen.getByRole<HTMLInputElement>('textbox', { name: 'answer' })
      await user.click(answer)
      answer.select()
      await user.paste('next')

      expect(
        JSON.parse(screen.getByRole('status', { name: 'Saved defaults' }).textContent!),
      ).toEqual([
        { key: 'answer', type: VarType.string, value: 'next' },
        { key: 'count', type: VarType.number, value: 7 },
      ])
      expect(answer).toHaveValue('next')
      expect(data.default_value?.[0]?.value).toBe('draft')
    })

    it('collapses and reopens the configured failure strategy', async () => {
      const user = userEvent.setup()
      renderPanel(baseData({ error_strategy: ErrorHandleTypeEnum.failBranch }))
      const title = 'workflow.nodes.common.errorHandle.title'
      const toggle = screen.getByRole('button', { name: title, expanded: true })
      await user.click(toggle)
      expect(
        screen.queryByText('workflow.nodes.common.errorHandle.failBranch.customize'),
      ).not.toBeInTheDocument()
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await user.click(toggle)
      expect(
        screen.getByText('workflow.nodes.common.errorHandle.failBranch.customize'),
      ).toBeInTheDocument()
      expect(screen.getByRole('status', { name: 'Saved error strategy' })).toHaveTextContent(
        ErrorHandleTypeEnum.failBranch,
      )
      expect(screen.getByRole('status', { name: 'Canvas edges' })).toHaveTextContent(
        'failure,success,unrelated',
      )
    })

    it('removes the failure route and defaults when stop-on-error is selected', async () => {
      const user = userEvent.setup()
      renderPanel(
        baseData({
          error_strategy: ErrorHandleTypeEnum.failBranch,
          default_value: [{ key: 'answer', type: VarType.string, value: 'old' }],
        }),
      )
      await user.click(
        screen.getByRole('button', { name: 'workflow.nodes.common.errorHandle.failBranch.title' }),
      )
      await user.click(
        screen.getByRole('menuitemradio', { name: /workflow.nodes.common.errorHandle.none.title/ }),
      )

      expect(screen.getByRole('status', { name: 'Saved error strategy' }).textContent).toBe('stop')
      expect(screen.getByRole('status', { name: 'Saved defaults' }).textContent).toBe('null')
      expect(screen.getByRole('status', { name: 'Canvas edges' }).textContent).toBe(
        'success,unrelated',
      )
      expect(
        screen.queryByText('workflow.nodes.common.errorHandle.failBranch.customize'),
      ).not.toBeInTheDocument()
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

      expect(
        screen.getByText('workflow.nodes.common.errorHandle.defaultValue.output'),
      ).toBeInTheDocument()
    })

    it('should render the fail-branch node badge when the node throws an exception', () => {
      renderErrorHandleNode(
        baseData({
          error_strategy: ErrorHandleTypeEnum.failBranch,
          _runningStatus: NodeRunningStatus.Exception,
        }),
      )

      return waitFor(() => {
        expect(screen.getByText('workflow.common.onFailure')).toBeInTheDocument()
        expect(
          screen.getByText('workflow.nodes.common.errorHandle.failBranch.title'),
        ).toBeInTheDocument()
      })
    })
  })
})
