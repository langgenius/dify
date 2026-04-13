import type { VariableAssignerNodeType } from '../types'
import type { PanelProps } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import Panel from '../panel'

type MockVarGroupItemProps = {
  payload: {
    group_name?: string
    output_type: VarType
    variables: string[][]
  }
  groupEnabled: boolean
}

const mockUseConfig = vi.hoisted(() => vi.fn())
const mockVarGroupItemRender = vi.hoisted(() => vi.fn())

vi.mock('../use-config', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseConfig(...args),
}))

vi.mock('../components/var-group-item', () => ({
  __esModule: true,
  default: (props: MockVarGroupItemProps) => {
    mockVarGroupItemRender(props)
    return <div>{`${props.payload.group_name || 'root'}:${props.payload.output_type}:${props.groupEnabled}`}</div>
  },
}))

vi.mock('@/app/components/workflow/nodes/_base/components/output-vars', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  VarItem: ({ name, type, description }: { name: string, type: string, description: string }) => (
    <div>{`${name}:${type}:${description}`}</div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/remove-effect-var-confirm', () => ({
  __esModule: true,
  default: ({
    isShow,
    onCancel,
    onConfirm,
  }: {
    isShow: boolean
    onCancel: () => void
    onConfirm: () => void
  }) => isShow
    ? (
        <div>
          <button type="button" onClick={onCancel}>cancel-remove</button>
          <button type="button" onClick={onConfirm}>confirm-remove</button>
        </div>
      )
    : null,
}))

const createData = (overrides: Partial<VariableAssignerNodeType> = {}): VariableAssignerNodeType => ({
  title: 'Variable Assigner',
  desc: '',
  type: BlockEnum.VariableAssigner,
  output_type: VarType.string,
  variables: [['source-node', 'rootVar']],
  advanced_settings: {
    group_enabled: true,
    groups: [
      {
        groupId: 'group-1',
        group_name: 'Group1',
        output_type: VarType.string,
        variables: [['source-node', 'groupVar']],
      },
      {
        groupId: 'group-2',
        group_name: 'Group2',
        output_type: VarType.number,
        variables: [],
      },
    ],
  },
  ...overrides,
})

const panelProps = {} as PanelProps

describe('variable-assigner/panel', () => {
  const handleGroupEnabledChange = vi.fn()
  const handleAddGroup = vi.fn()
  const hideRemoveVarConfirm = vi.fn()
  const onRemoveVarConfirm = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseConfig.mockReturnValue({
      readOnly: false,
      inputs: createData(),
      handleListOrTypeChange: vi.fn(),
      isEnableGroup: true,
      handleGroupEnabledChange,
      handleAddGroup,
      handleListOrTypeChangeInGroup: vi.fn(() => vi.fn()),
      handleGroupRemoved: vi.fn(() => vi.fn()),
      handleVarGroupNameChange: vi.fn(() => vi.fn()),
      isShowRemoveVarConfirm: true,
      hideRemoveVarConfirm,
      onRemoveVarConfirm,
      getAvailableVars: vi.fn(() => []),
      filterVar: vi.fn(() => vi.fn(() => true)),
    })
  })

  it('renders grouped panels, output vars, and confirm actions when aggregation is enabled', async () => {
    const user = userEvent.setup()

    render(
      <Panel
        id="assigner-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    expect(screen.getByText('Group1:string:true')).toBeInTheDocument()
    expect(screen.getByText('Group2:number:true')).toBeInTheDocument()
    expect(screen.getByText(/Group1\.output:string:workflow\.nodes\.variableAssigner\.outputVars\.varDescribe/)).toBeInTheDocument()
    expect(screen.getByText(/Group2\.output:number:workflow\.nodes\.variableAssigner\.outputVars\.varDescribe/)).toBeInTheDocument()

    await user.click(screen.getByRole('switch'))
    await user.click(screen.getByText('workflow.nodes.variableAssigner.addGroup'))
    await user.click(screen.getByRole('button', { name: 'cancel-remove' }))
    await user.click(screen.getByRole('button', { name: 'confirm-remove' }))

    expect(handleGroupEnabledChange).toHaveBeenCalled()
    expect(handleAddGroup).toHaveBeenCalledTimes(1)
    expect(hideRemoveVarConfirm).toHaveBeenCalledTimes(1)
    expect(onRemoveVarConfirm).toHaveBeenCalledTimes(1)
  })

  it('renders a single root group and hides output vars when aggregation is disabled', () => {
    mockUseConfig.mockReturnValue({
      readOnly: false,
      inputs: createData({
        advanced_settings: {
          group_enabled: false,
          groups: [],
        },
      }),
      handleListOrTypeChange: vi.fn(),
      isEnableGroup: false,
      handleGroupEnabledChange,
      handleAddGroup,
      handleListOrTypeChangeInGroup: vi.fn(() => vi.fn()),
      handleGroupRemoved: vi.fn(() => vi.fn()),
      handleVarGroupNameChange: vi.fn(() => vi.fn()),
      isShowRemoveVarConfirm: false,
      hideRemoveVarConfirm,
      onRemoveVarConfirm,
      getAvailableVars: vi.fn(() => []),
      filterVar: vi.fn(() => vi.fn(() => true)),
    })

    render(
      <Panel
        id="assigner-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    expect(screen.getByText('root:string:false')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.variableAssigner.aggregationGroup')).toBeInTheDocument()
    expect(screen.queryByText(/Group1\.output:string:workflow\.nodes\.variableAssigner\.outputVars\.varDescribe/)).not.toBeInTheDocument()
  })
})
