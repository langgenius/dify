/* eslint-disable ts/no-explicit-any, style/jsx-one-expression-per-line */
import type { ListFilterNodeType } from '../types'
import type { PanelProps } from '@/types/workflow'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import ExtractInput from '../components/extract-input'
import LimitConfig from '../components/limit-config'
import SubVariablePicker from '../components/sub-variable-picker'
import Node from '../node'
import Panel from '../panel'
import { OrderBy } from '../types'
import useConfig from '../use-config'

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  default: vi.fn((_nodeId: string, options?: any) => ({
    availableVars: [
      { variable: ['node-1', 'size'], type: VarType.number },
      { variable: ['node-1', 'name'], type: VarType.string },
    ].filter(varPayload => options?.filterVar ? options.filterVar(varPayload) : true),
    availableNodesWithParent: [{ id: 'node-1', data: { title: 'Answer', type: BlockEnum.Answer } }],
  })),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/input-support-select-var', () => ({
  default: ({ value, onChange, placeholder, className, readOnly, onFocusChange }: any) => (
    <input
      value={value}
      placeholder={placeholder}
      className={className}
      readOnly={readOnly}
      onFocus={() => onFocusChange?.(true)}
      onBlur={() => onFocusChange?.(false)}
      onChange={event => onChange(event.target.value)}
    />
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/field', () => ({
  default: ({ title, operations, children }: any) => <div><div>{title}</div><div>{operations}</div>{children}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/input-number-with-slider', () => ({
  default: ({ value, onChange }: any) => (
    <button type="button" onClick={() => onChange(value + 1)}>
      slider-{value}
    </button>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/option-card', () => ({
  default: ({ title, onSelect }: any) => <button type="button" onClick={onSelect}>{title}</button>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/output-vars', () => ({
  default: ({ children }: any) => <div>{children}</div>,
  VarItem: ({ name, type }: any) => <div>{name}:{type}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/split', () => ({
  default: () => <div>split</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: ({ onChange }: any) => <button type="button" onClick={() => onChange(['node-1', 'items'])}>pick-var</button>,
}))

vi.mock('../components/filter-condition', () => ({
  default: ({ onChange }: any) => <button type="button" onClick={() => onChange({ key: 'size' })}>filter-condition</button>,
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
  filter_by: { enabled: true, conditions: [{ key: 'size', comparison_operator: 'equal', value: '1' }] as any },
  extract_by: { enabled: true, serial: '1' },
  limit: { enabled: true, size: 10 },
  order_by: { enabled: true, key: 'size', value: OrderBy.ASC },
  ...overrides,
})

const createConfigResult = (overrides: Partial<ReturnType<typeof useConfig>> = {}): ReturnType<typeof useConfig> => ({
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

const renderPanel = (data: ListFilterNodeType = createData()) => (
  render(<Panel id="node-1" data={data} panelProps={panelProps} />)
)

describe('list-operator path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseConfig.mockReturnValue(createConfigResult())
  })

  // The list-operator path should expose extract, limit, ordering, and node variable previews.
  describe('Path Integration', () => {
    it('should update the extract input', async () => {
      const onChange = vi.fn()
      const { rerender } = render(
        <ExtractInput
          nodeId="node-1"
          readOnly={false}
          value="1"
          onChange={onChange}
        />,
      )

      fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '2' } })
      fireEvent.focus(screen.getByDisplayValue('1'))
      expect(screen.getByDisplayValue('1')).toHaveClass('border-components-input-border-active')

      rerender(
        <ExtractInput
          nodeId="node-1"
          readOnly
          value=""
          onChange={onChange}
        />,
      )

      expect(onChange).toHaveBeenCalled()
      expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', '')
    })

    it('should change the selected sub variable', async () => {
      const onChange = vi.fn()
      const { unmount } = render(
        <SubVariablePicker
          value="size"
          onChange={onChange}
        />,
      )

      const trigger = screen.getByRole('button')

      await act(async () => {
        fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      })

      const option = await screen.findByText('name')
      await act(async () => {
        fireEvent.click(option)
      })

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith('name')
      })

      unmount()
      render(
        <SubVariablePicker
          value=""
          onChange={onChange}
        />,
      )

      expect(screen.getByText('common.placeholder.select')).toBeInTheDocument()
    })

    it('should toggle limit and update the size slider', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const { rerender } = render(
        <LimitConfig
          readonly={false}
          config={{ enabled: true, size: 10 }}
          onChange={onChange}
        />,
      )

      await user.click(screen.getByText('slider-10'))

      expect(onChange).toHaveBeenCalledWith({ enabled: true, size: 11 })

      rerender(
        <LimitConfig
          readonly={false}
          config={{ enabled: false, size: 10 }}
          onChange={onChange}
        />,
      )

      expect(screen.queryByText('slider-10')).not.toBeInTheDocument()
      await user.click(screen.getByRole('switch'))
      expect(onChange).toHaveBeenCalledWith({ enabled: true, size: 10 })
    })

    it('should render the selected input variable in the node preview', () => {
      renderWorkflowFlowComponent(
        <Node
          id="node-2"
          data={createData()}
        />,
        {
          nodes: [{ id: 'node-1', position: { x: 0, y: 0 }, data: { type: BlockEnum.Answer, title: 'Answer' } as any }],
          edges: [],
        },
      )

      expect(screen.getByText('Answer')).toBeInTheDocument()
      expect(screen.getByText('items')).toBeInTheDocument()
    })

    it('should resolve system variables through the start node and return null without a variable', () => {
      const { rerender } = renderWorkflowFlowComponent(
        <Node
          id="node-2"
          data={createData({ variable: ['sys', 'files'] as any })}
        />,
        {
          nodes: [{ id: 'start', position: { x: 0, y: 0 }, data: { type: BlockEnum.Start, title: 'Start' } as any }],
          edges: [],
        },
      )

      expect(screen.getByText('Start')).toBeInTheDocument()

      rerender(
        <Node
          id="node-2"
          data={createData({ variable: [] as any })}
        />,
      )

      expect(screen.queryByText('workflow.nodes.listFilter.inputVar')).not.toBeInTheDocument()
      expect(screen.queryByText('Start')).not.toBeInTheDocument()
    })

    it('should render the panel controls and output vars', async () => {
      const user = userEvent.setup()
      renderPanel()

      await user.click(screen.getByText('pick-var'))
      await user.click(screen.getByText('filter-condition'))
      await user.click(screen.getByText('workflow.nodes.listFilter.asc'))

      expect(screen.getByText('result:Array[number]')).toBeInTheDocument()
      expect(screen.getByText('first_record:number')).toBeInTheDocument()
      expect(screen.getByText('last_record:number')).toBeInTheDocument()
    })

    it('should hide disabled sections and render order controls without sub variables', () => {
      mockUseConfig.mockReturnValueOnce(createConfigResult({
        inputs: createData({
          variable: undefined as any,
          filter_by: { enabled: false, conditions: [] as any },
          extract_by: { enabled: false, serial: '' },
          order_by: { enabled: false, key: '', value: OrderBy.ASC },
        }),
        hasSubVariable: false,
      }))

      const { rerender } = renderPanel()

      expect(screen.queryByText('filter-condition')).not.toBeInTheDocument()
      expect(screen.queryByDisplayValue('1')).not.toBeInTheDocument()
      expect(screen.queryByText('workflow.nodes.listFilter.asc')).not.toBeInTheDocument()

      mockUseConfig.mockReturnValueOnce(createConfigResult({
        inputs: createData({
          order_by: { enabled: true, key: '', value: OrderBy.ASC },
        }),
        hasSubVariable: false,
      }))

      rerender(<Panel id="node-1" data={createData()} panelProps={panelProps} />)

      expect(screen.getByText('workflow.nodes.listFilter.asc')).toBeInTheDocument()
      expect(screen.queryByText('common.placeholder.select')).not.toBeInTheDocument()
    })
  })
})
