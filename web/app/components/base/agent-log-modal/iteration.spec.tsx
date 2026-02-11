import type { AgentIteration } from '@/models/log'
import { render, screen } from '@testing-library/react'
import Iteration from './iteration'

const mockIterationInfo: AgentIteration = {
  created_at: '2023-01-01',
  files: [],
  thought: 'Test thought',
  tokens: 100,
  tool_calls: [
    {
      status: 'success',
      tool_name: 'test_tool',
      tool_label: { en: 'Test Tool' },
      tool_icon: null,
    },
  ],
  tool_raw: {
    inputs: '{}',
    outputs: 'test output',
  },
}

describe('Iteration', () => {
  it('should render final processing when isFinal is true', () => {
    render(<Iteration iterationInfo={mockIterationInfo} isFinal={true} index={1} />)

    expect(screen.getByText(/appLog.agentLogDetail.finalProcessing/i)).toBeInTheDocument()
    expect(screen.queryByText(/appLog.agentLogDetail.iteration/i)).not.toBeInTheDocument()
  })

  it('should render iteration index when isFinal is false', () => {
    render(<Iteration iterationInfo={mockIterationInfo} isFinal={false} index={2} />)

    expect(screen.getByText(/APPLOG.AGENTLOGDETAIL.ITERATION 2/i)).toBeInTheDocument()
    expect(screen.queryByText(/appLog.agentLogDetail.finalProcessing/i)).not.toBeInTheDocument()
  })

  it('should render LLM tool call and subsequent tool calls', () => {
    render(<Iteration iterationInfo={mockIterationInfo} isFinal={false} index={1} />)
    expect(screen.getByTitle('LLM')).toBeInTheDocument()
    expect(screen.getByText('Test Tool')).toBeInTheDocument()
  })
})
