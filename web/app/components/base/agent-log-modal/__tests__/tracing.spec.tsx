import type { AgentIterationLogResponse } from '@dify/contracts/api/console/apps/types.gen'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import TracingPanel from '../tracing'

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ title, value }: { title: React.ReactNode; value: string | object }) => (
    <div data-testid="code-editor">
      {title}
      {typeof value === 'string' ? value : JSON.stringify(value)}
    </div>
  ),
}))

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

    const editors = screen
      .getAllByTestId('code-editor')
      .filter((editor) => /Thought \d/.test(editor.textContent ?? ''))
    expect(editors.map((editor) => editor.textContent)).toEqual([
      'THOUGHTThought 1',
      'THOUGHTThought 2',
      'FINAL ANSWERThought 3',
    ])
    expect(within(editors[2]!).getByText('FINAL ANSWER')).toBeInTheDocument()
    expect(screen.getAllByText('THOUGHT')).toHaveLength(2)
    expect(screen.getByText('FINAL ANSWER')).toBeInTheDocument()
  })
})
