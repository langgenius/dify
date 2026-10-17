import type { LLMNodeType, StructuredOutput } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { BlockEnum } from '@/app/components/workflow/types'
import { Type } from '../../types'
import PanelOutputSection from '../panel-output-section'

const mockStructureOutput = vi.fn()

vi.mock('../structure-output', () => ({
  __esModule: true,
  StructureOutput: (props: {
    className?: string
    readOnly: boolean
    value?: StructuredOutput
    onChange: (value: StructuredOutput) => void
  }) => {
    mockStructureOutput(props)
    return <div data-testid="structure-output">structured-output</div>
  },
}))

const createInputs = (overrides: Partial<LLMNodeType> = {}): LLMNodeType => ({
  title: 'LLM',
  desc: '',
  type: BlockEnum.LLM,
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: 'chat' as const,
    completion_params: {},
  },
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

  it('expands output details through the real section control', async () => {
    const Harness = () => {
      const [collapsed, setCollapsed] = useState(true)
      return (
        <PanelOutputSection
          readOnly={false}
          inputs={createInputs()}
          isModelSupportStructuredOutput
          structuredOutputCollapsed={collapsed}
          setStructuredOutputCollapsed={setCollapsed}
          handleStructureOutputEnableChange={vi.fn()}
          handleStructureOutputChange={vi.fn()}
        />
      )
    }
    render(<Harness />)
    expect(screen.queryByText('reasoning_content')).not.toBeInTheDocument()
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'workflow.nodes.common.outputVars' }))
    expect(screen.getByText('reasoning_content')).toBeInTheDocument()
    expect(screen.getByText('usage')).toBeInTheDocument()
    expect(screen.queryByTestId('structure-output')).not.toBeInTheDocument()
  })

  it('passes the read-only permission to configured output', () => {
    render(
      <PanelOutputSection
        readOnly={true}
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
        handleStructureOutputEnableChange={vi.fn()}
        handleStructureOutputChange={vi.fn()}
      />,
    )

    expect(screen.getByTestId('structure-output')).toBeInTheDocument()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
    expect(mockStructureOutput).toHaveBeenCalledWith(expect.objectContaining({ readOnly: true }))
  })
  it('opens the model warning with the keyboard without changing structured output', async () => {
    const user = userEvent.setup()
    const onEnable = vi.fn()
    render(
      <PanelOutputSection
        readOnly={false}
        inputs={createInputs({ structured_output_enabled: true })}
        isModelSupportStructuredOutput={false}
        structuredOutputCollapsed={false}
        setStructuredOutputCollapsed={vi.fn()}
        handleStructureOutputEnableChange={onEnable}
        handleStructureOutputChange={vi.fn()}
      />,
    )
    screen.getByRole('button', { name: 'app.structOutput.modelNotSupported' }).focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'app.structOutput.modelNotSupportedTip',
    )
    expect(onEnable).not.toHaveBeenCalled()
  })
})
