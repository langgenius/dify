import type { ListFilterNodeType } from '../types'
import type { PanelProps } from '@/types/workflow'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowFlowComponent as renderFlow } from '@/app/components/workflow/__tests__/workflow-test-env'
import { ComparisonOperator } from '@/app/components/workflow/nodes/if-else/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import ExtractInput from '../components/extract-input'
import LimitConfig from '../components/limit-config'
import SubVariablePicker from '../components/sub-variable-picker'
import Node from '../node'
import Panel from '../panel'
import { OrderBy } from '../types'

const renderWorkflowFlowComponent = (
  ui: Parameters<typeof renderFlow>[0],
  options: Parameters<typeof renderFlow>[1] = {},
) => {
  const { queryClient } = createConsoleQueryWrapper()
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  return renderFlow(ui, { queryClient, ...options })
}

const createData = (overrides: Partial<ListFilterNodeType> = {}): ListFilterNodeType => ({
  title: 'List Operator',
  desc: '',
  type: BlockEnum.ListFilter,
  variable: ['node-1', 'items'],
  var_type: VarType.arrayNumber,
  item_var_type: VarType.number,
  filter_by: {
    enabled: true,
    conditions: [{ key: 'size', comparison_operator: ComparisonOperator.equal, value: '1' }],
  },
  extract_by: { enabled: true, serial: '1' },
  limit: { enabled: true, size: 10 },
  order_by: { enabled: true, key: 'size', value: OrderBy.ASC },
  ...overrides,
})

const panelProps: PanelProps = {
  getInputVars: vi.fn(() => []),
  toVarInputs: vi.fn(() => []),
  runInputData: {},
  runInputDataRef: { current: {} },
  setRunInputData: vi.fn(),
  runResult: null,
}

const renderPanel = (data: ListFilterNodeType = createData()) =>
  renderWorkflowFlowComponent(<Panel id="node-1" data={data} panelProps={panelProps} />, {
    nodes: [{ id: 'node-1', position: { x: 0, y: 0 }, data }],
  })

describe('list-operator path', () => {
  // The list-operator path should expose extract, limit, ordering, and node variable previews.
  describe('Path Integration', () => {
    it('should update the extract input', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const { rerender } = renderWorkflowFlowComponent(
        <ExtractInput nodeId="node-1" readOnly={false} value="1" onChange={onChange} />,
      )

      const editor = screen.getByRole('textbox')
      expect(editor).toHaveTextContent('1')
      await user.type(editor, '2')
      await waitFor(() => expect(onChange).toHaveBeenCalledWith('12'))

      rerender(<ExtractInput nodeId="node-1" readOnly value="" onChange={onChange} />)

      await waitFor(() => expect(editor).toHaveAttribute('contenteditable', 'false'))
      await user.type(editor, '3')
      expect(editor).toHaveTextContent('')
    })

    it('should change the selected sub variable', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const { unmount } = render(<SubVariablePicker value="size" onChange={onChange} />)

      await user.click(screen.getByRole('combobox'))
      await user.click(screen.getByRole('option', { name: 'name' }))

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith('name')
      })

      unmount()
      render(<SubVariablePicker value="" onChange={onChange} />)

      expect(screen.getByText('common.placeholder.select')).toBeInTheDocument()
    })

    it('should toggle limit and update the size slider', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const { rerender } = render(
        <LimitConfig readonly={false} config={{ enabled: true, size: 10 }} onChange={onChange} />,
      )

      screen.getByRole('slider', { name: 'workflowLogic.nodes.listFilter.limit' }).focus()
      await user.keyboard('{ArrowRight}')

      expect(onChange).toHaveBeenCalledWith({ enabled: true, size: 11 })

      rerender(
        <LimitConfig readonly={false} config={{ enabled: false, size: 10 }} onChange={onChange} />,
      )

      expect(screen.queryByRole('slider')).not.toBeInTheDocument()
      await user.click(screen.getByRole('switch'))
      expect(onChange).toHaveBeenCalledWith({ enabled: true, size: 10 })
    })

    it('prevents changing the limit in readonly mode', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<LimitConfig readonly config={{ enabled: true, size: 10 }} onChange={onChange} />)

      expect(screen.getByRole('spinbutton')).toBeDisabled()
      await user.click(screen.getByRole('switch'))
      await user.type(screen.getByRole('spinbutton'), '2')
      expect(onChange).not.toHaveBeenCalled()
    })

    it('should render the selected input variable in the node preview', () => {
      renderWorkflowFlowComponent(<Node id="node-2" data={createData()} />, {
        nodes: [
          {
            id: 'node-1',
            position: { x: 0, y: 0 },
            data: { type: BlockEnum.Answer, title: 'Answer', desc: '' },
          },
        ],
        edges: [],
      })

      expect(screen.getByText('Answer')).toBeInTheDocument()
      expect(screen.getByText('items')).toBeInTheDocument()
    })

    it('should resolve system variables through the start node and return null without a variable', () => {
      const { rerender } = renderWorkflowFlowComponent(
        <Node id="node-2" data={createData({ variable: ['sys', 'files'] })} />,
        {
          nodes: [
            {
              id: 'start',
              position: { x: 0, y: 0 },
              data: { type: BlockEnum.Start, title: 'Start', desc: '' },
            },
          ],
          edges: [],
        },
      )

      expect(screen.getByText('Start')).toBeInTheDocument()

      rerender(<Node id="node-2" data={createData({ variable: [] })} />)

      expect(screen.queryByText('workflow.nodes.listFilter.inputVar')).not.toBeInTheDocument()
      expect(screen.queryByText('Start')).not.toBeInTheDocument()
    })

    it('should hide disabled sections and render order controls without sub variables', () => {
      const data = createData({
        variable: [],
        filter_by: { enabled: false, conditions: [] },
        extract_by: { enabled: false, serial: '' },
        order_by: { enabled: false, key: '', value: OrderBy.ASC },
      })
      const { unmount } = renderPanel(data)
      expect(
        screen.queryByText('workflowIntegrations.nodes.http.extractListPlaceholder'),
      ).not.toBeInTheDocument()
      expect(screen.queryByText('workflowLogic.nodes.listFilter.asc')).not.toBeInTheDocument()
      unmount()
      renderPanel(createData({ ...data, order_by: { enabled: true, key: '', value: OrderBy.ASC } }))

      expect(screen.getByText('workflowLogic.nodes.listFilter.asc')).toBeInTheDocument()
      expect(screen.queryByText('common.placeholder.select')).not.toBeInTheDocument()
    })
  })
})
