import type { AgentIterationLogResponse } from '@dify/contracts/api/console/apps/types.gen'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vite-plus/test'
import TracingPanel from '../tracing'

const createIteration = (thought: string, tokens: number): AgentIterationLogResponse => ({
  created_at: '',
  files: [],
  thought,
  tokens,
  tool_calls: [
    {
      tool_name: 'tool1',
      status: 'success',
      tool_icon: null,
      tool_label: { 'en-US': 'Tool 1' },
      time_cost: 0,
      tool_input: {},
      tool_output: {},
      tool_parameters: {},
    },
  ],
  tool_raw: { inputs: '', outputs: '' },
})

const mockList: AgentIterationLogResponse[] = [
  createIteration('Thought 1', 10),
  createIteration('Thought 2', 20),
  createIteration('Thought 3', 30),
]

describe('TracingPanel', () => {
  it('keeps iterations in order and identifies only the last thought as the final answer', async () => {
    const user = userEvent.setup()
    render(<TracingPanel list={mockList} />)

    expect(screen.getAllByText(/ITERATION/i).map((element) => element.textContent)).toEqual([
      'APPLOG.AGENTLOGDETAIL.ITERATION 1',
      'APPLOG.AGENTLOGDETAIL.ITERATION 2',
    ])
    expect(screen.getByText(/finalProcessing/i)).toBeInTheDocument()

    for (const llm of screen.getAllByText('LLM')) await user.click(llm)

    const editors = screen.getAllByRole('textbox') as HTMLTextAreaElement[]
    expect(editors.map((editor) => JSON.parse(editor.value))).toEqual([
      '',
      'Thought 1',
      '',
      'Thought 2',
      '',
      'Thought 3',
    ])
    for (const editor of editors) expect(editor).toHaveAttribute('readonly')
    expect(
      screen.getAllByText(/^(?:THOUGHT|FINAL ANSWER)$/).map((title) => title.textContent),
    ).toEqual(['THOUGHT', 'THOUGHT', 'FINAL ANSWER'])
    expect(screen.getByText('FINAL ANSWER')).toBeInTheDocument()
  })
})
