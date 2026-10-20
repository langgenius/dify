import type { ComponentProps } from 'react'
import type { ListFilterNodeType } from '../types'
import type { PanelProps } from '@/types/workflow'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { ComparisonOperator } from '@/app/components/workflow/nodes/if-else/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import ExtractInput from '../components/extract-input'
import LimitConfig from '../components/limit-config'
import SubVariablePicker from '../components/sub-variable-picker'
import Node from '../node'
import Panel from '../panel'
import { OrderBy } from '../types'
import useConfig from '../use-config'

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  default: () => ({ availableVars: [], availableNodesWithParent: [] }),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/input-support-select-var', () => ({
  default: ({
    value,
    onChange,
    placeholder,
    className,
    readOnly,
    onFocusChange,
  }: ComponentProps<
    typeof import('@/app/components/workflow/nodes/_base/components/input-support-select-var').default
  >) => (
    <input
      value={value}
      placeholder={placeholder}
      className={className}
      readOnly={readOnly}
      onFocus={() => onFocusChange?.(true)}
      onBlur={() => onFocusChange?.(false)}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: ({
    onChange,
  }: ComponentProps<
    typeof import('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker').default
  >) => (
    <button type="button" onClick={() => onChange(['node-1', 'items'], VarKindType.variable)}>
      pick-var
    </button>
  ),
}))

vi.mock('../components/filter-condition', () => ({
  default: ({
    onChange,
  }: ComponentProps<typeof import('../components/filter-condition').default>) => (
    <button
      type="button"
      onClick={() =>
        onChange({ key: 'size', comparison_operator: ComparisonOperator.equal, value: '1' })
      }
    >
      filter-condition
    </button>
  ),
}))

vi.mock('../use-config', () => ({
  default: vi.fn(),
}))

const mockUseConfig = vi.mocked(useConfig)

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

const createConfigResult = (
  overrides: Partial<ReturnType<typeof useConfig>> = {},
): ReturnType<typeof useConfig> => ({
  readOnly: false,
  inputs: createData(),
  filterVar: vi.fn(() => true),
  varType: VarType.arrayNumber,
  itemVarType: VarType.number,
  itemVarTypeShowName: 'number',
  hasSubVariable: true,
  handleVarChanges: vi.fn(),
  handleFilterEnabledChange: vi.fn(),
  handleFilterChange: vi.fn(),
  handleLimitChange: vi.fn(),
  handleOrderByEnabledChange: vi.fn(),
  handleOrderByKeyChange: vi.fn(),
  handleOrderByTypeChange: vi.fn(() => vi.fn()),
  handleExtractsEnabledChange: vi.fn(),
  handleExtractsChange: vi.fn(),
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
  render(<Panel id="node-1" data={data} panelProps={panelProps} />)

describe('list-operator path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseConfig.mockReturnValue(createConfigResult())
  })

  // The list-operator path should expose extract, limit, ordering, and node variable previews.
  describe('Path Integration', () => {
    it('should update the extract input', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const { rerender } = render(
        <ExtractInput nodeId="node-1" readOnly={false} value="1" onChange={onChange} />,
      )

      fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '2' } })
      expect(onChange).toHaveBeenCalledWith('2')
      onChange.mockClear()

      rerender(<ExtractInput nodeId="node-1" readOnly value="" onChange={onChange} />)

      await user.type(screen.getByRole('textbox'), '3')
      expect(screen.getByRole('textbox')).toHaveValue('')
      expect(onChange).not.toHaveBeenCalled()
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
      mockUseConfig.mockReturnValue(
        createConfigResult({
          inputs: createData({
            variable: [],
            filter_by: { enabled: false, conditions: [] },
            extract_by: { enabled: false, serial: '' },
            order_by: { enabled: false, key: '', value: OrderBy.ASC },
          }),
          hasSubVariable: false,
        }),
      )

      const { rerender } = renderPanel()

      expect(screen.queryByText('filter-condition')).not.toBeInTheDocument()
      expect(screen.queryByDisplayValue('1')).not.toBeInTheDocument()
      expect(screen.queryByText('workflowLogic.nodes.listFilter.asc')).not.toBeInTheDocument()

      mockUseConfig.mockReturnValue(
        createConfigResult({
          inputs: createData({
            order_by: { enabled: true, key: '', value: OrderBy.ASC },
          }),
          hasSubVariable: false,
        }),
      )

      rerender(<Panel id="node-1" data={createData()} panelProps={panelProps} />)

      expect(screen.getByText('workflowLogic.nodes.listFilter.asc')).toBeInTheDocument()
      expect(screen.queryByText('common.placeholder.select')).not.toBeInTheDocument()
    })
  })
})
