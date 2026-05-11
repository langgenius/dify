import type { ReactNode } from 'react'
import type { CodeNodeType, OutputVar } from '../types'
import type useConfig from '../use-config'
import type { NodePanelProps, Variable } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import Panel from '../panel'
import { CodeLanguage } from '../types'

const mockUseConfig = vi.hoisted(() => vi.fn())
const mockExtractFunctionParams = vi.hoisted(() => vi.fn())
const mockExtractReturnType = vi.hoisted(() => vi.fn())
const mockCodeEditor = vi.hoisted(() => vi.fn())
const mockVarList = vi.hoisted(() => vi.fn())
const mockOutputVarList = vi.hoisted(() => vi.fn())
const mockRemoveEffectVarConfirm = vi.hoisted(() => vi.fn())

vi.mock('../use-config', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseConfig(...args),
}))

vi.mock('../code-parser', () => ({
  extractFunctionParams: (...args: unknown[]) => mockExtractFunctionParams(...args),
  extractReturnType: (...args: unknown[]) => mockExtractReturnType(...args),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  __esModule: true,
  default: (props: {
    readOnly: boolean
    language: CodeLanguage
    value: string
    onChange: (value: string) => void
    onGenerated: (value: string) => void
    title: ReactNode
  }) => {
    mockCodeEditor(props)
    return (
      <div>
        <div>{props.readOnly ? 'editor:readonly' : 'editor:editable'}</div>
        <div>{props.language}</div>
        <div>{props.title}</div>
        <button type="button" onClick={() => props.onChange('generated code body')}>
          change-code
        </button>
        <button type="button" onClick={() => props.onGenerated('generated signature code')}>
          generate-code
        </button>
      </div>
    )
  },
}))

vi.mock('@/app/components/workflow/nodes/_base/components/selector', () => ({
  __esModule: true,
  default: (props: {
    value: CodeLanguage
    onChange: (value: CodeLanguage) => void
  }) => (
    <button type="button" onClick={() => props.onChange(CodeLanguage.python3)}>
      {`language:${props.value}`}
    </button>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-list', () => ({
  __esModule: true,
  default: (props: {
    readonly: boolean
    list: Variable[]
    onChange: (list: Variable[]) => void
  }) => {
    mockVarList(props)
    return (
      <div>
        <div>{props.readonly ? 'var-list:readonly' : 'var-list:editable'}</div>
        <button
          type="button"
          onClick={() => props.onChange([{
            variable: 'changed',
            value_selector: ['start', 'changed'],
          }])}
        >
          change-var-list
        </button>
      </div>
    )
  },
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/output-var-list', () => ({
  __esModule: true,
  default: (props: {
    readonly: boolean
    outputs: OutputVar
    onChange: (outputs: OutputVar) => void
    onRemove: (name: string) => void
  }) => {
    mockOutputVarList(props)
    return (
      <div>
        <div>{props.readonly ? 'output-list:readonly' : 'output-list:editable'}</div>
        <button
          type="button"
          onClick={() => props.onChange({
            next_result: {
              type: VarType.number,
              children: null,
            },
          })}
        >
          change-output-list
        </button>
        <button type="button" onClick={() => props.onRemove('result')}>
          remove-output
        </button>
      </div>
    )
  },
}))

vi.mock('../../_base/components/remove-effect-var-confirm', () => ({
  __esModule: true,
  default: (props: {
    isShow: boolean
    onCancel: () => void
    onConfirm: () => void
  }) => {
    mockRemoveEffectVarConfirm(props)
    return props.isShow
      ? (
          <div>
            <button type="button" onClick={props.onCancel}>
              cancel-remove
            </button>
            <button type="button" onClick={props.onConfirm}>
              confirm-remove
            </button>
          </div>
        )
      : null
  },
}))

const createData = (overrides: Partial<CodeNodeType> = {}): CodeNodeType => ({
  title: 'Code',
  desc: '',
  type: BlockEnum.Code,
  code_language: CodeLanguage.javascript,
  code: 'function main({ foo }) { return { result: foo } }',
  variables: [{
    variable: 'foo',
    value_selector: ['start', 'foo'],
    value_type: VarType.string,
  }],
  outputs: {
    result: {
      type: VarType.string,
      children: null,
    },
  },
  ...overrides,
})

const createConfigResult = (overrides: Partial<ReturnType<typeof useConfig>> = {}): ReturnType<typeof useConfig> => ({
  readOnly: false,
  inputs: createData(),
  outputKeyOrders: ['result'],
  handleCodeAndVarsChange: vi.fn(),
  handleVarListChange: vi.fn(),
  handleAddVariable: vi.fn(),
  handleRemoveVariable: vi.fn(),
  handleSyncFunctionSignature: vi.fn(),
  handleCodeChange: vi.fn(),
  handleCodeLanguageChange: vi.fn(),
  handleVarsChange: vi.fn(),
  handleAddOutputVariable: vi.fn(),
  filterVar: vi.fn(() => true),
  isShowRemoveVarConfirm: true,
  hideRemoveVarConfirm: vi.fn(),
  onRemoveVarConfirm: vi.fn(),
  ...overrides,
})

const renderPanel = (data: CodeNodeType = createData()) => {
  const props: NodePanelProps<CodeNodeType> = {
    id: 'code-node',
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

describe('code/panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExtractFunctionParams.mockReturnValue(['summary', 'count'])
    mockExtractReturnType.mockReturnValue({
      result: {
        type: VarType.string,
        children: null,
      },
    })
    mockUseConfig.mockReturnValue(createConfigResult())
  })

  it('renders editable controls and forwards all input, output, and code actions', async () => {
    const user = userEvent.setup()
    const config = createConfigResult()
    mockUseConfig.mockReturnValue(config)

    renderPanel()

    expect(screen.getByText('workflow.nodes.code.inputVars')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.code.outputVars')).toBeInTheDocument()
    expect(screen.getByText('editor:editable')).toBeInTheDocument()
    expect(screen.getByText('language:javascript')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.add workflow.nodes.code.inputVars' }))
    await user.click(screen.getByRole('button', { name: 'workflow.nodes.code.syncFunctionSignature' }))
    await user.click(screen.getByRole('button', { name: 'change-code' }))
    await user.click(screen.getByRole('button', { name: 'generate-code' }))
    await user.click(screen.getByRole('button', { name: 'language:javascript' }))
    await user.click(screen.getByRole('button', { name: 'change-var-list' }))
    await user.click(screen.getByRole('button', { name: 'change-output-list' }))
    await user.click(screen.getByRole('button', { name: 'remove-output' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.add workflow.nodes.code.outputVars' }))
    await user.click(screen.getByRole('button', { name: 'cancel-remove' }))
    await user.click(screen.getByRole('button', { name: 'confirm-remove' }))

    expect(config.handleAddVariable).toHaveBeenCalled()
    expect(config.handleSyncFunctionSignature).toHaveBeenCalled()
    expect(config.handleCodeChange).toHaveBeenCalledWith('generated code body')
    expect(config.handleCodeLanguageChange).toHaveBeenCalledWith(CodeLanguage.python3)
    expect(config.handleVarListChange).toHaveBeenCalledWith([{
      variable: 'changed',
      value_selector: ['start', 'changed'],
    }])
    expect(config.handleVarsChange).toHaveBeenCalledWith({
      next_result: {
        type: VarType.number,
        children: null,
      },
    })
    expect(config.handleRemoveVariable).toHaveBeenCalledWith('result')
    expect(config.handleAddOutputVariable).toHaveBeenCalled()
    expect(config.hideRemoveVarConfirm).toHaveBeenCalled()
    expect(config.onRemoveVarConfirm).toHaveBeenCalled()
    expect(config.handleCodeAndVarsChange).toHaveBeenCalledWith(
      'generated signature code',
      [{
        variable: 'summary',
        value_selector: [],
      }, {
        variable: 'count',
        value_selector: [],
      }],
      {
        result: {
          type: VarType.string,
          children: null,
        },
      },
    )
    expect(mockExtractFunctionParams).toHaveBeenCalledWith('generated signature code', CodeLanguage.javascript)
    expect(mockExtractReturnType).toHaveBeenCalledWith('generated signature code', CodeLanguage.javascript)
  })

  it('removes input actions in readonly mode and passes readonly state to child sections', () => {
    mockUseConfig.mockReturnValue(createConfigResult({
      readOnly: true,
      isShowRemoveVarConfirm: false,
    }))

    renderPanel()

    expect(screen.queryByRole('button', { name: 'workflow.nodes.code.syncFunctionSignature' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.add workflow.nodes.code.inputVars' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.add workflow.nodes.code.outputVars' })).toBeInTheDocument()
    expect(screen.getByText('editor:readonly')).toBeInTheDocument()
    expect(screen.getByText('var-list:readonly')).toBeInTheDocument()
    expect(screen.getByText('output-list:readonly')).toBeInTheDocument()
    expect(mockRemoveEffectVarConfirm).toHaveBeenCalled()
  })
})
