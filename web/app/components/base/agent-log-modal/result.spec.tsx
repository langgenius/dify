import { render, screen } from '@testing-library/react'
import * as React from 'react'
import ResultPanel from './result'

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ title, value }: { title: React.ReactNode, value: string | object }) => (
    <div data-testid="code-editor">
      <div data-testid="code-editor-title">{title}</div>
      <div data-testid="code-editor-value">{JSON.stringify(value)}</div>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/run/status', () => ({
  default: ({ status, time, tokens, error }: { status: string, time?: number, tokens?: number, error?: string }) => (
    <div data-testid="status-panel">
      <span>{status}</span>
      <span>{time}</span>
      <span>{tokens}</span>
      <span>{error}</span>
    </div>
  ),
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: vi.fn((ts, _format) => `formatted-${ts}`),
  }),
}))

const mockProps = {
  status: 'succeeded',
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
  it('should render status panel and code editors', () => {
    render(<ResultPanel {...mockProps} />)

    expect(screen.getByTestId('status-panel')).toBeInTheDocument()

    const editors = screen.getAllByTestId('code-editor')
    expect(editors).toHaveLength(2)

    expect(screen.getByText('INPUT')).toBeInTheDocument()
    expect(screen.getByText('OUTPUT')).toBeInTheDocument()
    expect(screen.getByText(JSON.stringify(mockProps.inputs))).toBeInTheDocument()
    expect(screen.getByText(JSON.stringify(mockProps.outputs))).toBeInTheDocument()
  })

  it('should display correct metadata', () => {
    render(<ResultPanel {...mockProps} />)

    expect(screen.getByText('User Name')).toBeInTheDocument()
    expect(screen.getByText('1.235s')).toBeInTheDocument() // toFixed(3)
    expect(screen.getByText('150 Tokens')).toBeInTheDocument()
    expect(screen.getByText('appDebug.agent.agentModeType.functionCall')).toBeInTheDocument()
    expect(screen.getByText('tool1, tool2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()

    // Check formatted time
    expect(screen.getByText(/formatted-/)).toBeInTheDocument()
  })

  it('should handle missing created_by and tools', () => {
    render(<ResultPanel {...mockProps} created_by={undefined} tools={[]} />)

    expect(screen.getByText('N/A')).toBeInTheDocument()
    expect(screen.getByText('Null')).toBeInTheDocument()
  })

  it('should display ReACT mode correctly', () => {
    render(<ResultPanel {...mockProps} agentMode="react" />)
    expect(screen.getByText('appDebug.agent.agentModeType.ReACT')).toBeInTheDocument()
  })
})
