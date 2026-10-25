import type { VariableAssignerNodeType } from '../types'
import type { PanelProps } from '@/types/workflow'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import Panel from '../panel'
import { renderAssigner as render } from './test-helpers'

const mockUseConfig = vi.hoisted(() => vi.fn())

vi.mock('../use-config', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseConfig(...args),
}))

const createData = (
  overrides: Partial<VariableAssignerNodeType> = {},
): VariableAssignerNodeType => ({
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
      isShowRemoveVarConfirm: false,
      hideRemoveVarConfirm,
      onRemoveVarConfirm,
      getAvailableVars: vi.fn(() => []),
      filterVar: vi.fn(() => vi.fn(() => true)),
    })
  })

  it('renders grouped panels and adds or disables aggregation groups', async () => {
    const user = userEvent.setup()

    render(<Panel id="assigner-node" data={createData()} panelProps={panelProps} />)

    expect(screen.getByText('Group1')).toBeInTheDocument()
    expect(screen.getByText('Group2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'workflow.nodes.common.outputVars' }))
    expect(screen.getByText('Group1.output')).toBeInTheDocument()
    expect(screen.getByText('Group2.output')).toBeInTheDocument()

    await user.click(screen.getByRole('switch'))
    await user.click(screen.getByText('workflowLogic.nodes.variableAssigner.addGroup'))

    expect(handleGroupEnabledChange).toHaveBeenCalledWith(false, expect.anything())
    expect(handleAddGroup).toHaveBeenCalledTimes(1)
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

    render(<Panel id="assigner-node" data={createData()} panelProps={panelProps} />)

    expect(screen.getByText('rootVar')).toBeInTheDocument()
    expect(
      screen.getByText('workflowLogic.nodes.variableAssigner.aggregationGroup'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Group1.output')).not.toBeInTheDocument()
  })
  it('prevents adding or renaming groups in read-only mode', async () => {
    const user = userEvent.setup()
    mockUseConfig.mockReturnValue({ ...mockUseConfig(), readOnly: true })
    render(<Panel id="assigner-node" data={createData()} panelProps={panelProps} />)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.queryByRole('button', { name: 'workflowLogic.nodes.variableAssigner.addGroup' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByText('Group1'))
    expect(screen.queryByDisplayValue('Group1')).not.toBeInTheDocument()
    expect(handleAddGroup).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'confirm'])(
    'forwards the real confirmation dialog %s action',
    async (action) => {
      const user = userEvent.setup()
      mockUseConfig.mockReturnValue({ ...mockUseConfig(), isShowRemoveVarConfirm: true })
      render(<Panel id="assigner-node" data={createData()} panelProps={panelProps} />)
      await user.click(screen.getByRole('button', { name: `common.operation.${action}` }))
      expect(action === 'cancel' ? hideRemoveVarConfirm : onRemoveVarConfirm).toHaveBeenCalled()
    },
  )
})
