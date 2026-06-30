import type { WorkflowGenPlan } from '@/service/debug'
import { render, screen } from '@testing-library/react'
import GenerationPlan from '../generation-plan'

describe('GenerationPlan', () => {
  // Before the planner returns, the right pane shows the "Planning…" phase so
  // the user sees real progress rather than a bare spinner.
  it('shows the planning state while the plan is null', () => {
    render(<GenerationPlan plan={null} />)
    expect(screen.getByText(/workflowGenerator\.phases\.planning/i)).toBeInTheDocument()
  })

  // Once the plan streams in, the outline (node purposes + identity) renders and
  // the footer flips to "Building…" while the builder fills in the graph.
  it('renders the plan outline and the building state once the plan lands', () => {
    const plan: WorkflowGenPlan = {
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
    render(<GenerationPlan plan={plan} />)

    expect(screen.getByText('URL Summarizer')).toBeInTheDocument()
    expect(screen.getByText('capture the URL')).toBeInTheDocument()
    expect(screen.getByText('summarize the page')).toBeInTheDocument()
    expect(screen.getByText(/workflowGenerator\.phases\.building/i)).toBeInTheDocument()
    // The planning-only state must be gone once a plan is present.
    expect(screen.queryByText(/workflowGenerator\.phases\.planning/i)).not.toBeInTheDocument()
  })
})
