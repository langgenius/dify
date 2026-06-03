import type { ReactNode } from 'react'
import type { Variable } from '../../../types'
import type { TemplateTransformNodeType } from '../types'
import type { PanelProps } from '@/types/workflow'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum, VarType } from '../../../types'
import Node from '../node'
import Panel from '../panel'
import useConfig from '../use-config'

vi.mock('@/app/components/workflow/nodes/_base/components/field', () => ({
  __esModule: true,
  default: ({ title, operations, children }: { title: ReactNode, operations?: ReactNode, children: ReactNode }) => (
    <div>
      <div>{title}</div>
      <div>{operations}</div>
      {children}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/output-vars', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  VarItem: ({ name, type }: { name: string, type: string }) => <div>{`${name}:${type}`}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/split', () => ({
  __esModule: true,
  default: () => <div>split</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-list', () => ({
  __esModule: true,
  default: ({
    onChange,
    onVarNameChange,
  }: {
    onChange: (value: Variable[]) => void
    onVarNameChange: (oldName: string, newName: string) => void
  }) => (
    <div>
      <button
        type="button"
        onClick={() => onChange([{
          variable: 'updated_input',
          value_selector: ['node-1', 'updated_input'],
          value_type: VarType.string,
        }])}
      >
        change-var-list
      </button>
      <button type="button" onClick={() => onVarNameChange('input_text', 'renamed_input')}>
        rename-var
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor/editor-support-vars', () => ({
  __esModule: true,
  default: ({
    onAddVar,
    headerRight,
    value,
    onChange,
  }: {
    onAddVar: (value: Variable) => void
    headerRight?: ReactNode
    value: string
    onChange: (value: string) => void
  }) => (
    <div>
      <div>{headerRight}</div>
      <button
        type="button"
        onClick={() => onAddVar({
          variable: 'result_text',
          value_selector: ['node-2', 'result_text'],
          value_type: VarType.string,
        })}
      >
        add-var
      </button>
      <textarea
        aria-label="template-editor"
        value={value}
        onChange={event => onChange(event.target.value)}
      />
    </div>
  ),
}))

vi.mock('../use-config', () => ({
  __esModule: true,
  default: vi.fn(),
}))

const mockUseConfig = vi.mocked(useConfig)

const createVariable = (overrides: Partial<Variable> = {}): Variable => ({
  variable: 'input_text',
  value_selector: ['node-1', 'input_text'],
  value_type: VarType.string,
  ...overrides,
})

const createData = (overrides: Partial<TemplateTransformNodeType> = {}): TemplateTransformNodeType => ({
  title: 'Template Transform',
  desc: '',
  type: BlockEnum.TemplateTransform,
  variables: [createVariable()],
  template: '{{ input_text }}',
  ...overrides,
})

const createConfigResult = (overrides: Partial<ReturnType<typeof useConfig>> = {}): ReturnType<typeof useConfig> => ({
  readOnly: false,
  inputs: createData(),
  availableVars: [],
  handleVarListChange: vi.fn(),
  handleVarNameChange: vi.fn(),
  handleAddVariable: vi.fn(),
  handleAddEmptyVariable: vi.fn(),
  handleCodeChange: vi.fn(),
  filterVar: () => true,
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

describe('template-transform path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseConfig.mockReturnValue(createConfigResult())
  })

  it('should render the node shell without summary content', () => {
    const { container } = render(
      <Node
        id="template-node"
        data={createData()}
      />,
    )

    expect(container.firstElementChild).toBeEmptyDOMElement()
  })

  it('should wire variable list and code editor actions from the panel', async () => {
    const user = userEvent.setup()
    const handleVarListChange = vi.fn()
    const handleVarNameChange = vi.fn()
    const handleAddVariable = vi.fn()
    const handleAddEmptyVariable = vi.fn()
    const handleCodeChange = vi.fn()

    mockUseConfig.mockReturnValueOnce(createConfigResult({
      handleVarListChange,
      handleVarNameChange,
      handleAddVariable,
      handleAddEmptyVariable,
      handleCodeChange,
    }))

    render(
      <Panel
        id="template-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.add workflow.nodes.templateTransform.inputVars' }))
    await user.click(screen.getByRole('button', { name: 'change-var-list' }))
    await user.click(screen.getByRole('button', { name: 'rename-var' }))
    await user.click(screen.getByRole('button', { name: 'add-var' }))
    fireEvent.change(screen.getByLabelText('template-editor'), { target: { value: '{{ renamed_input }}' } })

    expect(handleAddEmptyVariable).toHaveBeenCalled()
    expect(handleVarListChange).toHaveBeenCalledWith([
      {
        variable: 'updated_input',
        value_selector: ['node-1', 'updated_input'],
        value_type: VarType.string,
      },
    ])
    expect(handleVarNameChange).toHaveBeenCalledWith('input_text', 'renamed_input')
    expect(handleAddVariable).toHaveBeenCalledWith({
      variable: 'result_text',
      value_selector: ['node-2', 'result_text'],
      value_type: VarType.string,
    })
    expect(handleCodeChange).toHaveBeenCalledWith('{{ renamed_input }}')
    expect(screen.getByText('output:string')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /workflow.nodes.templateTransform.codeSupportTip/i })).toHaveAttribute(
      'href',
      'https://jinja.palletsprojects.com/en/3.1.x/templates/',
    )
  })

  it('should hide the add-variable operation when the panel is read only', () => {
    mockUseConfig.mockReturnValueOnce(createConfigResult({
      readOnly: true,
    }))

    render(
      <Panel
        id="template-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    expect(screen.queryByRole('button', { name: 'common.operation.add workflow.nodes.templateTransform.inputVars' })).not.toBeInTheDocument()
  })
})
