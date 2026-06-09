import type { AssignerNodeOperation, AssignerNodeType } from '../types'
import type { PanelProps } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import Panel from '../panel'
import { AssignerNodeInputType, WriteMode } from '../types'

type MockVarListProps = {
  readonly: boolean
  nodeId: string
  list: AssignerNodeOperation[]
  onChange: (list: AssignerNodeOperation[]) => void
}

const mockUseConfig = vi.hoisted(() => vi.fn())
const mockUseHandleAddOperationItem = vi.hoisted(() => vi.fn())
const mockVarListRender = vi.hoisted(() => vi.fn())

const createOperation = (overrides: Partial<AssignerNodeOperation> = {}): AssignerNodeOperation => ({
  variable_selector: ['node-1', 'count'],
  input_type: AssignerNodeInputType.variable,
  operation: WriteMode.overwrite,
  value: ['node-2', 'result'],
  ...overrides,
})

vi.mock('../use-config', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseConfig(...args),
}))

vi.mock('../hooks', () => ({
  useHandleAddOperationItem: () => mockUseHandleAddOperationItem,
}))

vi.mock('../components/var-list', () => ({
  __esModule: true,
  default: (props: MockVarListProps) => {
    mockVarListRender(props)
    return (
      <div>
        <div>{props.list.map(item => item.variable_selector.join('.')).join(',')}</div>
        <button type="button" onClick={() => props.onChange([createOperation({ variable_selector: ['node-1', 'updated'] })])}>
          emit-list-change
        </button>
      </div>
    )
  },
}))

const createData = (overrides: Partial<AssignerNodeType> = {}): AssignerNodeType => ({
  title: 'Assigner',
  desc: '',
  type: BlockEnum.VariableAssigner,
  version: '2',
  items: [createOperation()],
  ...overrides,
})

const panelProps = {} as PanelProps

describe('assigner/panel', () => {
  const handleOperationListChanges = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseHandleAddOperationItem.mockReturnValue([
      createOperation(),
      createOperation({ variable_selector: [] }),
    ])
    mockUseConfig.mockReturnValue({
      readOnly: false,
      inputs: createData(),
      handleOperationListChanges,
      getAssignedVarType: vi.fn(),
      getToAssignedVarType: vi.fn(),
      writeModeTypesNum: [],
      writeModeTypesArr: [],
      writeModeTypes: [],
      filterAssignedVar: vi.fn(),
      filterToAssignedVar: vi.fn(),
    })
  })

  it('passes the resolved config to the variable list and appends operations through the add button', async () => {
    const user = userEvent.setup()

    render(
      <Panel
        id="assigner-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    expect(screen.getByText('workflow.nodes.assigner.variables')).toBeInTheDocument()
    expect(screen.getByText('node-1.count')).toBeInTheDocument()
    expect(mockVarListRender).toHaveBeenCalledWith(expect.objectContaining({
      readonly: false,
      nodeId: 'assigner-node',
      list: createData().items,
    }))

    await user.click(screen.getAllByRole('button')[0]!)

    expect(mockUseHandleAddOperationItem).toHaveBeenCalledWith(createData().items)
    expect(handleOperationListChanges).toHaveBeenCalledWith([
      createOperation(),
      createOperation({ variable_selector: [] }),
    ])

    await user.click(screen.getByRole('button', { name: 'emit-list-change' }))

    expect(handleOperationListChanges).toHaveBeenCalledWith([
      createOperation({ variable_selector: ['node-1', 'updated'] }),
    ])
  })
})
