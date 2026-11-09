import type { WorkflowGeneratePlanEventResponse } from '@dify/contracts/api/console/workflow-generate/types.gen'
import { render, screen } from '@testing-library/react'
import GenerationPlan from '../generation-plan'

describe('GenerationPlan', () => {
  it('transitions from planning to the streamed outline while graph construction continues', () => {
    const { rerender } = render(<GenerationPlan plan={null} />)
    expect(screen.getByRole('status').textContent).toMatch(/workflowGenerator\.phases\.planning/i)
    const plan: WorkflowGeneratePlanEventResponse = {
      app_name: 'URL Summarizer',
      description: 'Summarize any URL',
      icon: '📰',
      mode: 'workflow',
      nodes: [
        { label: 'Start', node_type: 'start', purpose: 'capture the URL' },
        { label: 'Summarize', node_type: 'llm', purpose: 'summarize the page' },
      ],
      start_inputs: [{ variable: 'url', label: 'URL', type: 'text-input' }],
    }
    rerender(<GenerationPlan plan={plan} />)

    expect(screen.getByText('URL Summarizer')).toBeInTheDocument()
    expect(screen.getByText('capture the URL')).toBeInTheDocument()
    expect(screen.getByText('summarize the page')).toBeInTheDocument()
    expect(screen.getByRole('status').textContent).toMatch(/workflowGenerator\.phases\.building/i)
    expect(screen.queryByText(/workflowGenerator\.phases\.planning/i)).not.toBeInTheDocument()
  })

  it('falls back to plan.title when plan.app_name is empty', () => {
    const plan: WorkflowGeneratePlanEventResponse = {
      app_name: '',
      title: 'Fallback Title',
      mode: 'workflow',
      nodes: [],
      start_inputs: [],
    }
    render(<GenerationPlan plan={plan} />)

    expect(screen.getByText('Fallback Title')).toBeInTheDocument()
  })
})
