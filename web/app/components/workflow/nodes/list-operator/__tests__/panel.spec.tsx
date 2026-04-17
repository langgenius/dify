import type { ReactNode } from 'react'
import type { ListFilterNodeType } from '../types'
import type useConfig from '../use-config'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import Panel from '../panel'
import { OrderBy } from '../types'

const mockUseConfig = vi.hoisted(() => vi.fn())
const mockSwitch = vi.hoisted(() => vi.fn())
const mockVarReferencePicker = vi.hoisted(() => vi.fn())
const mockFilterCondition = vi.hoisted(() => vi.fn())
const mockExtractInput = vi.hoisted(() => vi.fn())
const mockLimitConfig = vi.hoisted(() => vi.fn())
const mockSubVariablePicker = vi.hoisted(() => vi.fn())
const mockOptionCard = vi.hoisted(() => vi.fn())

vi.mock('../use-config', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseConfig(...args),
}))

vi.mock('@/app/components/base/switch', () => ({
  __esModule: true,
  default: (props: {
    checked?: boolean
    disabled?: boolean
    onCheckedChange: (value: boolean) => void
  }) => {
    mockSwitch(props)
    return (
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        disabled={props.disabled}
        onClick={() => props.onCheckedChange(!props.checked)}
      >
        {props.disabled ? 'switch:disabled' : 'switch:enabled'}
      </button>
    )
  },
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  __esModule: true,
  default: (props: {
    readonly: boolean
    value: string[]
    onChange: (value: string[]) => void
  }) => {
    mockVarReferencePicker(props)
    return (
      <button type="button" onClick={() => props.onChange(['node-2', 'records'])}>
        {props.readonly ? 'var-picker:readonly' : `var-picker:${props.value.join('.')}`}
      </button>
    )
  },
}))

vi.mock('../components/filter-condition', () => ({
  __esModule: true,
  default: (props: {
    readOnly: boolean
    onChange: (value: { key: string }) => void
  }) => {
    mockFilterCondition(props)
    return (
      <button type="button" onClick={() => props.onChange({ key: 'size' })}>
        {props.readOnly ? 'filter-condition:readonly' : 'filter-condition:editable'}
      </button>
    )
  },
}))

vi.mock('../components/extract-input', () => ({
  __esModule: true,
  default: (props: {
    value: string
    readOnly: boolean
    onChange: (value: string) => void
  }) => {
    mockExtractInput(props)
    return (
      <button type="button" onClick={() => props.onChange('2')}>
        {props.readOnly ? 'extract-input:readonly' : `extract-input:${props.value}`}
      </button>
    )
  },
}))

vi.mock('../components/limit-config', () => ({
  __esModule: true,
  default: (props: {
    readonly: boolean
    config: { enabled: boolean, size?: number }
    onChange: (config: { enabled: boolean, size?: number }) => void
  }) => {
    mockLimitConfig(props)
    return (
      <button
        type="button"
        onClick={() => props.onChange({ enabled: true, size: (props.config.size || 0) + 1 })}
      >
        {props.readonly ? 'limit-config:readonly' : `limit-config:${props.config.size || 0}`}
      </button>
    )
  },
}))

vi.mock('../components/sub-variable-picker', () => ({
  __esModule: true,
  default: (props: {
    value: string
    onChange: (value: string) => void
  }) => {
    mockSubVariablePicker(props)
    return (
      <button type="button" onClick={() => props.onChange('name')}>
        {`sub-variable:${props.value || 'empty'}`}
      </button>
    )
  },
}))

vi.mock('../../_base/components/option-card', () => ({
  __esModule: true,
  default: (props: {
    title: string
    selected: boolean
    onSelect: () => void
  }) => {
    mockOptionCard(props)
    return (
      <button type="button" onClick={props.onSelect}>
        {`${props.title}:${props.selected ? 'selected' : 'idle'}`}
      </button>
    )
  },
}))

vi.mock('../../_base/components/output-vars', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  VarItem: ({ name, type, description }: { name: string, type: string, description: string }) => (
    <div>{`${name}:${type}:${description}`}</div>
  ),
}))

const createData = (overrides: Partial<ListFilterNodeType> = {}): ListFilterNodeType => ({
  title: 'List Operator',
  desc: '',
  type: BlockEnum.ListFilter,
  variable: ['answer-node', 'items'],
  var_type: VarType.arrayObject,
  item_var_type: VarType.object,
  filter_by: {
    enabled: true,
    conditions: [{
      key: 'name',
      comparison_operator: 'contains' as never,
      value: '',
    }],
  },
  extract_by: {
    enabled: true,
    serial: '1',
  },
  order_by: {
    enabled: true,
    key: 'size',
    value: OrderBy.ASC,
  },
  limit: {
    enabled: true,
    size: 10,
  },
  ...overrides,
})

const createConfigResult = (overrides: Partial<ReturnType<typeof useConfig>> = {}): ReturnType<typeof useConfig> => ({
  readOnly: false,
  inputs: createData(),
  varType: VarType.arrayObject,
  itemVarType: VarType.object,
  itemVarTypeShowName: 'Object',
  hasSubVariable: true,
  handleVarChanges: vi.fn(),
  filterVar: vi.fn(() => true),
  handleFilterEnabledChange: vi.fn(),
  handleFilterChange: vi.fn(),
  handleExtractsEnabledChange: vi.fn(),
  handleExtractsChange: vi.fn(),
  handleLimitChange: vi.fn(),
  handleOrderByEnabledChange: vi.fn(),
  handleOrderByKeyChange: vi.fn(),
  handleOrderByTypeChange: vi.fn((value: OrderBy) => () => value),
  ...overrides,
})

const renderPanel = (data: ListFilterNodeType = createData()) => {
  const props: NodePanelProps<ListFilterNodeType> = {
    id: 'list-node',
    data,
    panelProps: {
      getInputVars: vi.fn(() => []),
      toVarInputs: vi.fn(() => []),
      runInputData: {},
      runInputDataRef: { current: {} },
      setRunInputData: vi.fn(),
      runResult: null,
    },
  }

  return render(<Panel {...props} />)
}

describe('list-operator/panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseConfig.mockReturnValue(createConfigResult())
  })

  it('renders enabled sections and forwards all main interactions', async () => {
    const user = userEvent.setup()
    const config = createConfigResult({
      handleOrderByTypeChange: vi.fn((value: OrderBy) => () => config.handleOrderByEnabledChange(value === OrderBy.ASC)),
    })
    mockUseConfig.mockReturnValue(config)

    renderPanel()

    expect(screen.getByText('workflow.nodes.listFilter.inputVar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'var-picker:answer-node.items' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'filter-condition:editable' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'extract-input:1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'limit-config:10' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'sub-variable:size' })).toBeInTheDocument()
    expect(screen.getByText('result:Array[Object]:workflow.nodes.listFilter.outputVars.result')).toBeInTheDocument()
    expect(screen.getByText('first_record:Object:workflow.nodes.listFilter.outputVars.first_record')).toBeInTheDocument()
    expect(screen.getByText('last_record:Object:workflow.nodes.listFilter.outputVars.last_record')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'var-picker:answer-node.items' }))
    await user.click(screen.getByRole('button', { name: 'filter-condition:editable' }))
    await user.click(screen.getByRole('button', { name: 'extract-input:1' }))
    await user.click(screen.getByRole('button', { name: 'limit-config:10' }))
    await user.click(screen.getByRole('button', { name: 'sub-variable:size' }))
    await user.click(screen.getAllByRole('switch')[0]!)
    await user.click(screen.getAllByRole('switch')[1]!)
    await user.click(screen.getAllByRole('switch')[2]!)
    await user.click(screen.getByRole('button', { name: 'workflow.nodes.listFilter.asc:selected' }))
    await user.click(screen.getByRole('button', { name: 'workflow.nodes.listFilter.desc:idle' }))

    expect(config.handleVarChanges).toHaveBeenCalledWith(['node-2', 'records'])
    expect(config.handleFilterChange).toHaveBeenCalledWith({ key: 'size' })
    expect(config.handleExtractsChange).toHaveBeenCalledWith('2')
    expect(config.handleLimitChange).toHaveBeenCalledWith({ enabled: true, size: 11 })
    expect(config.handleOrderByKeyChange).toHaveBeenCalledWith('name')
    expect(config.handleFilterEnabledChange).toHaveBeenCalledWith(false)
    expect(config.handleExtractsEnabledChange).toHaveBeenCalledWith(false)
    expect(config.handleOrderByEnabledChange).toHaveBeenCalled()
    expect(config.handleOrderByTypeChange).toHaveBeenCalledWith(OrderBy.ASC)
    expect(config.handleOrderByTypeChange).toHaveBeenCalledWith(OrderBy.DESC)
  })

  it('hides disabled sections and forwards readonly state to child controls', () => {
    mockUseConfig.mockReturnValue(createConfigResult({
      readOnly: true,
      hasSubVariable: false,
      inputs: createData({
        filter_by: {
          enabled: false,
          conditions: [],
        },
        extract_by: {
          enabled: false,
          serial: '',
        },
        order_by: {
          enabled: false,
          key: '',
          value: OrderBy.DESC,
        },
      }),
    }))

    renderPanel()

    expect(screen.getByRole('button', { name: 'var-picker:readonly' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'limit-config:readonly' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'filter-condition:readonly' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'extract-input:' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'sub-variable:empty' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'workflow.nodes.listFilter.asc:idle' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('switch')).toHaveLength(3)
    expect(screen.getAllByRole('switch').every(button => button.hasAttribute('disabled'))).toBe(true)
  })
})
