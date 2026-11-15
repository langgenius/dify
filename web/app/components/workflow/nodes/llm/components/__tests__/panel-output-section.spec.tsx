import type { LLMNodeType } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { BlockEnum } from '@/app/components/workflow/types'
import { Type } from '../../types'
import PanelOutputSection from '../panel-output-section'

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
  it('expands output details through the real section control', async () => {
    const user = userEvent.setup()
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
    await user.click(screen.getByRole('button', { name: 'workflow.nodes.common.outputVars' }))
    expect(screen.getByText('reasoning_content')).toBeInTheDocument()
    expect(screen.getByText('usage')).toBeInTheDocument()
    expect(screen.queryByText('structured_output')).not.toBeInTheDocument()
  })

  it('shows configured output as read-only and disables its switch', () => {
    render(
      <PanelOutputSection
        readOnly={true}
        inputs={createInputs({
          structured_output_enabled: true,
          structured_output: {
            schema: {
              type: Type.object,
              properties: {
                result: {
                  type: Type.object,
                  description: 'Result details',
                  properties: {
                    answer: {
                      type: Type.string,
                      description: 'Final answer',
                    },
                  },
                  required: ['answer'],
                },
              },
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

    expect(screen.getByText('structured_output')).toBeInTheDocument()
    expect(screen.getByText('result')).toBeInTheDocument()
    expect(screen.getByText('Final answer')).toBeInTheDocument()
    expect(screen.getByText('app.structOutput.required')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'app.structOutput.configure' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
  })
  it('opens the model warning with the keyboard without changing structured output', async () => {
    const user = userEvent.setup()
    const Harness = () => {
      const [enabled, setEnabled] = useState(true)
      return (
        <PanelOutputSection
          readOnly={false}
          inputs={createInputs({ structured_output_enabled: enabled })}
          isModelSupportStructuredOutput={false}
          structuredOutputCollapsed={false}
          setStructuredOutputCollapsed={() => undefined}
          handleStructureOutputEnableChange={setEnabled}
          handleStructureOutputChange={() => undefined}
        />
      )
    }
    render(<Harness />)
    expect(screen.getByRole('switch')).toBeChecked()
    screen.getByRole('button', { name: 'app.structOutput.modelNotSupported' }).focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'app.structOutput.modelNotSupportedTip',
    )
    expect(screen.getByRole('switch')).toBeChecked()
  })
})
