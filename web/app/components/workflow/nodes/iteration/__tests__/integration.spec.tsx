import type { ReactNode } from 'react'
import type { IterationNodeType } from '../types'
import type { PanelProps } from '@/types/workflow'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/components/base/ui/toast'
import { ErrorHandleMode } from '@/app/components/workflow/types'
import { BlockEnum, VarType } from '../../../types'
import AddBlock from '../add-block'
import Node from '../node'
import Panel from '../panel'
import useConfig from '../use-config'

const mockHandleNodeAdd = vi.fn()
const mockHandleNodeIterationRerender = vi.fn()
let mockNodesReadOnly = false

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('reactflow', async () => {
  const actual = await vi.importActual<typeof import('reactflow')>('reactflow')
  return {
    ...actual,
    Background: ({ id }: { id: string }) => <div data-testid={id} />,
    useViewport: () => ({ zoom: 1 }),
    useNodesInitialized: () => true,
  }
})

vi.mock('@/app/components/workflow/block-selector', () => ({
  __esModule: true,
  default: ({
    trigger,
    onSelect,
    availableBlocksTypes = [],
    disabled,
  }: {
    trigger?: (open: boolean) => ReactNode
    onSelect?: (type: BlockEnum) => void
    availableBlocksTypes?: BlockEnum[]
    disabled?: boolean
  }) => (
    <div>
      {trigger ? <div>{trigger(false)}</div> : null}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelect?.(availableBlocksTypes[0] ?? BlockEnum.Code)}
      >
        select-block
      </button>
    </div>
  ),
}))

vi.mock('../../iteration-start', () => ({
  IterationStartNodeDumb: () => <div>iteration-start-node</div>,
}))

vi.mock('../use-interactions', () => ({
  useNodeIterationInteractions: () => ({
    handleNodeIterationRerender: mockHandleNodeIterationRerender,
  }),
}))

vi.mock('../../../hooks', () => ({
  useAvailableBlocks: () => ({
    availableNextBlocks: [BlockEnum.Code],
  }),
  useNodesInteractions: () => ({
    handleNodeAdd: mockHandleNodeAdd,
  }),
  useNodesReadOnly: () => ({
    nodesReadOnly: mockNodesReadOnly,
  }),
}))

vi.mock('../../_base/components/variable/var-reference-picker', () => ({
  __esModule: true,
  default: ({
    onChange,
    availableVars,
  }: {
    onChange: (value: string[], kindType?: string, varInfo?: { type: VarType }) => void
    availableVars?: unknown[]
  }) => (
    <button
      type="button"
      onClick={() => {
        if (availableVars)
          onChange(['child-node', 'text'], 'variable', { type: VarType.string })
        else
          onChange(['node-1', 'items'], 'variable', { type: VarType.arrayString })
      }}
    >
      {availableVars ? 'pick-output-var' : 'pick-input-var'}
    </button>
  ),
}))

vi.mock('../use-config', () => ({
  __esModule: true,
  default: vi.fn(),
}))

const mockUseConfig = vi.mocked(useConfig)
const mockToastWarning = vi.mocked(toast.warning)

const createData = (overrides: Partial<IterationNodeType> = {}): IterationNodeType => ({
  title: 'Iteration',
  desc: '',
  type: BlockEnum.Iteration,
  start_node_id: 'start-node',
  iterator_selector: ['node-1', 'items'],
  iterator_input_type: VarType.arrayString,
  output_selector: ['child-node', 'text'],
  output_type: VarType.arrayString,
  is_parallel: false,
  parallel_nums: 3,
  error_handle_mode: ErrorHandleMode.Terminated,
  flatten_output: false,
  _isShowTips: false,
  _children: [],
  ...overrides,
})

const createConfigResult = (overrides: Partial<ReturnType<typeof useConfig>> = {}): ReturnType<typeof useConfig> => ({
  readOnly: false,
  inputs: createData(),
  filterInputVar: () => true,
  handleInputChange: vi.fn(),
  childrenNodeVars: [],
  iterationChildrenNodes: [],
  handleOutputVarChange: vi.fn(),
  changeParallel: vi.fn(),
  changeErrorResponseMode: vi.fn(),
  changeParallelNums: vi.fn(),
  changeFlattenOutput: vi.fn(),
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

describe('iteration path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNodesReadOnly = false
    mockUseConfig.mockReturnValue(createConfigResult())
  })

  it('should add the next block from the iteration start node', async () => {
    const user = userEvent.setup()

    render(
      <AddBlock
        iterationNodeId="iteration-node"
        iterationNodeData={createData()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'select-block' }))

    expect(mockHandleNodeAdd).toHaveBeenCalledWith({
      nodeType: BlockEnum.Code,
      pluginDefaultValue: undefined,
    }, {
      prevNodeId: 'start-node',
      prevNodeSourceHandle: 'source',
    })
  })

  it('should render candidate iteration nodes and show the parallel warning once', () => {
    render(
      <Node
        id="iteration-node"
        data={createData({
          _isCandidate: true,
          _children: [{ nodeId: 'child-1', nodeType: BlockEnum.Iteration }],
          is_parallel: true,
          _isShowTips: true,
        })}
      />,
    )

    expect(screen.getByText('iteration-start-node')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'select-block' })).toBeInTheDocument()
    expect(screen.getByTestId('iteration-background-iteration-node')).toBeInTheDocument()
    expect(mockHandleNodeIterationRerender).toHaveBeenCalledWith('iteration-node')
    expect(mockToastWarning).toHaveBeenCalledWith('workflow.nodes.iteration.answerNodeWarningDesc')
  })

  it('should wire panel input, output, parallel, numeric, error mode, and flatten actions', async () => {
    const user = userEvent.setup()
    const handleInputChange = vi.fn()
    const handleOutputVarChange = vi.fn()
    const changeParallel = vi.fn()
    const changeParallelNums = vi.fn()
    const changeErrorResponseMode = vi.fn()
    const changeFlattenOutput = vi.fn()

    mockUseConfig.mockReturnValueOnce(createConfigResult({
      inputs: createData({
        is_parallel: true,
        flatten_output: false,
      }),
      handleInputChange,
      handleOutputVarChange,
      changeParallel,
      changeParallelNums,
      changeErrorResponseMode,
      changeFlattenOutput,
    }))

    render(
      <Panel
        id="iteration-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'pick-input-var' }))
    await user.click(screen.getByRole('button', { name: 'pick-output-var' }))
    await user.click(screen.getAllByRole('switch')[0]!)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '7' } })
    await user.click(screen.getByRole('button', { name: /workflow.nodes.iteration.ErrorMethod.operationTerminated/i }))
    await user.click(screen.getByText('workflow.nodes.iteration.ErrorMethod.continueOnError'))
    await user.click(screen.getAllByRole('switch')[1]!)

    expect(handleInputChange).toHaveBeenCalledWith(['node-1', 'items'], 'variable', { type: VarType.arrayString })
    expect(handleOutputVarChange).toHaveBeenCalledWith(['child-node', 'text'], 'variable', { type: VarType.string })
    expect(changeParallel).toHaveBeenCalledWith(false)
    expect(changeParallelNums).toHaveBeenCalledWith(7)
    expect(changeErrorResponseMode).toHaveBeenCalledWith(expect.objectContaining({
      value: ErrorHandleMode.ContinueOnError,
    }))
    expect(changeFlattenOutput).toHaveBeenCalledWith(true)
  })

  it('should hide parallel controls when parallel mode is disabled', () => {
    mockUseConfig.mockReturnValueOnce(createConfigResult({
      inputs: createData({
        is_parallel: false,
      }),
    }))

    render(
      <Panel
        id="iteration-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })
})
