import type { ReactNode } from 'react'
import type { CodeNodeType } from '../types'
import type useConfig from '../use-config'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import Panel from '../panel'
import { CodeLanguage } from '../types'

const mockUseConfig = vi.hoisted(() => vi.fn())
const generatedCode = 'function main(foo, newParam) { return { result: foo } }'

vi.mock('../use-config', () => ({ default: (...args: unknown[]) => mockUseConfig(...args) }))

// The editor owns Monaco and code generation; the panel owns parsing generated code.
vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: (props: {
    readOnly: boolean
    value: string
    onChange: (value: string) => void
    onGenerated: (value: string) => void
    title: ReactNode
  }) => (
    <div>
      {props.title}
      <textarea
        aria-label="Code"
        readOnly={props.readOnly}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <button
        type="button"
        disabled={props.readOnly}
        onClick={() => props.onGenerated(generatedCode)}
      >
        Generate code
      </button>
    </div>
  ),
}))

// Upstream variable browsing is a separate graph interaction; use the real input/output lists.
vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: () => <span>Upstream variable</span>,
}))

const createData = (overrides: Partial<CodeNodeType> = {}): CodeNodeType => ({
  title: 'Code',
  desc: '',
  type: BlockEnum.Code,
  code_language: CodeLanguage.javascript,
  code: 'function main(foo) { return { result: foo } }',
  variables: [{ variable: 'foo', value_selector: ['start', 'foo'], value_type: VarType.string }],
  outputs: { result: { type: VarType.string, children: null } },
  ...overrides,
})

const createConfig = (
  overrides: Partial<ReturnType<typeof useConfig>> = {},
): ReturnType<typeof useConfig> => ({
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
  isShowRemoveVarConfirm: false,
  hideRemoveVarConfirm: vi.fn(),
  onRemoveVarConfirm: vi.fn(),
  ...overrides,
})

const renderPanel = (config = createConfig()) => {
  mockUseConfig.mockReturnValue(config)
  const props: NodePanelProps<CodeNodeType> = {
    id: 'code-node',
    data: config.inputs,
    panelProps: {
      getInputVars: vi.fn(() => []),
      toVarInputs: vi.fn(() => []),
      runInputData: {},
      runInputDataRef: { current: {} },
      setRunInputData: vi.fn(),
      runResult: null,
    },
  }
  render(<Panel {...props} />)
  return config
}

describe('code panel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds inputs and outputs, synchronizes the signature, and removes outputs by row index', async () => {
    const user = userEvent.setup()
    const config = renderPanel()
    await user.click(
      screen.getByRole('button', { name: 'common.operation.add workflow.nodes.code.inputVars' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.code.syncFunctionSignature' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'common.operation.add workflow.nodes.code.outputVars' }),
    )
    const removeButtons = screen.getAllByRole('button', { name: /operation.remove/ })
    await user.click(removeButtons[0]!)
    await user.click(removeButtons[1]!)
    expect(config.handleAddVariable).toHaveBeenCalledOnce()
    expect(config.handleSyncFunctionSignature).toHaveBeenCalledOnce()
    expect(config.handleAddOutputVariable).toHaveBeenCalledOnce()
    expect(config.handleVarListChange).toHaveBeenCalledWith([])
    expect(config.handleRemoveVariable).toHaveBeenCalledWith(0)
  })

  it('changes the output type through the real type picker', async () => {
    const user = userEvent.setup()
    const config = renderPanel()
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'number' }))
    expect(config.handleVarsChange).toHaveBeenCalledWith({
      result: { type: VarType.number, children: null },
    })
  })

  it('parses generated code while retaining bindings for surviving parameters', async () => {
    const user = userEvent.setup()
    const config = renderPanel(
      createConfig({
        inputs: createData({
          variables: [
            { variable: 'foo', value_selector: ['start', 'foo'], value_type: VarType.string },
            { variable: 'removed', value_selector: ['start', 'removed'] },
          ],
        }),
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Generate code' }))
    expect(config.handleCodeAndVarsChange).toHaveBeenCalledExactlyOnceWith(
      generatedCode,
      [
        { variable: 'foo', value_selector: ['start', 'foo'], value_type: VarType.string },
        { variable: 'newParam', value_selector: [] },
      ],
      { result: { type: VarType.string, children: null } },
    )
  })

  it('prevents adding outputs or changing the language and variable names while readonly', async () => {
    const user = userEvent.setup()
    const config = renderPanel(createConfig({ readOnly: true }))
    expect(screen.queryByRole('button', { name: /operation.add/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /syncFunctionSignature/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /operation.remove/ })).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('foo')).toBeDisabled()
    expect(screen.getByDisplayValue('result')).toHaveAttribute('readonly')
    await user.type(screen.getByDisplayValue('result'), 'changed')
    await user.click(screen.getByText('JavaScript'))
    expect(screen.queryByText('Python3')).not.toBeInTheDocument()
    expect(config.handleVarsChange).not.toHaveBeenCalled()
    expect(config.handleCodeLanguageChange).not.toHaveBeenCalled()
  })

  it.each(['confirm', 'cancel'] as const)(
    'handles removal %s through the real confirmation dialog',
    async (action) => {
      const config = renderPanel(createConfig({ isShowRemoveVarConfirm: true }))
      await userEvent
        .setup()
        .click(screen.getByRole('button', { name: `common.operation.${action}` }))
      if (action === 'confirm') expect(config.onRemoveVarConfirm).toHaveBeenCalledOnce()
      else {
        expect(config.hideRemoveVarConfirm).toHaveBeenCalledOnce()
        expect(config.onRemoveVarConfirm).not.toHaveBeenCalled()
      }
    },
  )
})
