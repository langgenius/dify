import { screen } from '@testing-library/react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import ResultPanel from '../result'

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: vi.fn((ts, _format) => `formatted-${ts}`),
  }),
}))

const mockProps = {
  status: 'success',
  elapsed_time: 1.23456,
  total_tokens: 150,
  error: '',
  inputs: { query: 'input' },
  outputs: { answer: 'output' },
  created_by: 'User Name',
  created_at: '2023-01-01T00:00:00Z',
  agentMode: 'function_call',
  tools: ['tool1', 'tool2'],
  iterations: 3,
}

describe('ResultPanel', () => {
  it('shows inputs, outputs and execution metadata', () => {
    render(<ResultPanel {...mockProps} />)

    expect(screen.getByText('INPUT')).toBeInTheDocument()
    expect(screen.getByText('OUTPUT')).toBeInTheDocument()
    const editors = screen.getAllByRole('textbox') as HTMLTextAreaElement[]
    expect(editors.map((editor) => JSON.parse(editor.value))).toEqual([
      mockProps.inputs,
      mockProps.outputs,
    ])
    editors.forEach((editor) => expect(editor).toHaveAttribute('readonly'))
    expect(screen.getByText('User Name')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('appLog.status.succeeded')
    expect(screen.getByRole('status')).toHaveTextContent('1.235s')
    expect(screen.getByRole('status')).toHaveTextContent('150 Tokens')
    expect(screen.getByText('appDebug.agent.agentModeType.functionCall')).toBeInTheDocument()
    expect(screen.getByText('tool1, tool2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()

    // Check formatted time
    expect(screen.getByText(/formatted-/)).toBeInTheDocument()
  })

  it('shows available mode and fallbacks when execution metadata is missing', () => {
    render(
      <ResultPanel
        {...mockProps}
        created_by={undefined}
        tools={[]}
        total_tokens={undefined}
        agentMode="react"
      />,
    )

    expect(screen.getByText('N/A')).toBeInTheDocument()
    expect(screen.getByText('Null')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('0 Tokens')
    expect(screen.getByText('appDebug.agent.agentModeType.ReACT')).toBeInTheDocument()
  })
})
