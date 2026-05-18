import type { ReactNode } from 'react'
import type { LLMNodeType, StructuredOutput } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppModeEnum } from '@/types/app'
import { Type } from '../../types'
import PanelOutputSection from '../panel-output-section'

const mockOutputVars = vi.hoisted(() => vi.fn())
const mockStructureOutput = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/workflow/nodes/_base/components/output-vars', () => ({
  __esModule: true,
  default: ({
    children,
    operations,
    collapsed,
  }: {
    children: ReactNode
    operations?: ReactNode
    collapsed?: boolean
  }) => {
    mockOutputVars({ collapsed })
    return (
      <div>
        <div data-testid="output-vars-operations">{operations}</div>
        <div data-testid="output-vars-children">{children}</div>
      </div>
    )
  },
  VarItem: ({ name }: { name: string }) => <div>{name}</div>,
}))

vi.mock('../structure-output', () => ({
  __esModule: true,
  StructureOutput: (props: { className?: string, value?: StructuredOutput, onChange: (value: StructuredOutput) => void }) => {
    mockStructureOutput(props)
    return <div data-testid="structure-output">structured-output</div>
  },
}))

const createInputs = (overrides: Partial<LLMNodeType> = {}): LLMNodeType => ({
  title: 'LLM',
  desc: '',
  type: 'llm' as LLMNodeType['type'],
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: AppModeEnum.CHAT,
    completion_params: {},
  } as LLMNodeType['model'],
  prompt_template: [],
  context: {
    enabled: false,
    variable_selector: [],
  },
  vision: {
    enabled: false,
  },
  structured_output_enabled: false,
  ...overrides,
})

describe('llm/panel-output-section', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the default output vars and keeps structured output collapsed state', () => {
    render(
      <PanelOutputSection
        readOnly={false}
        inputs={createInputs()}
        isModelSupportStructuredOutput={true}
        structuredOutputCollapsed={true}
        setStructuredOutputCollapsed={vi.fn()}
        handleStructureOutputEnableChange={vi.fn()}
        handleStructureOutputChange={vi.fn()}
      />,
    )

    expect(screen.getByText('text')).toBeInTheDocument()
    expect(screen.getByText('reasoning_content')).toBeInTheDocument()
    expect(screen.getByText('usage')).toBeInTheDocument()
    expect(mockOutputVars).toHaveBeenCalledWith({ collapsed: true })
    expect(screen.queryByTestId('structure-output')).not.toBeInTheDocument()
  })

  it('renders the structured output editor and toggles the switch when structured output is enabled', async () => {
    const user = userEvent.setup()
    const handleStructureOutputEnableChange = vi.fn()

    render(
      <PanelOutputSection
        readOnly={false}
        inputs={createInputs({
          structured_output_enabled: true,
          structured_output: {
            schema: {
              type: Type.object,
              properties: {},
              additionalProperties: false,
            },
          },
        })}
        isModelSupportStructuredOutput={false}
        structuredOutputCollapsed={false}
        setStructuredOutputCollapsed={vi.fn()}
        handleStructureOutputEnableChange={handleStructureOutputEnableChange}
        handleStructureOutputChange={vi.fn()}
      />,
    )

    expect(screen.getByTestId('structure-output')).toBeInTheDocument()
    expect(mockStructureOutput).toHaveBeenCalled()

    await user.click(screen.getByRole('switch'))
    expect(handleStructureOutputEnableChange).toHaveBeenCalledWith(false)
  })
})
