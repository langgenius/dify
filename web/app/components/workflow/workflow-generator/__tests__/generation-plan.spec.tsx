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

  it('renders correctly when plan has no icon, app_name, or title', () => {
    const plan: WorkflowGenPlan = {
      mode: 'workflow',
      nodes: [
        { label: 'Start', node_type: 'start' },
      ],
      start_inputs: [],
    } as unknown as WorkflowGenPlan
    render(<GenerationPlan plan={plan} />)

    expect(screen.getByText('Start')).toBeInTheDocument()
    expect(screen.getByText(/workflowGenerator\.phases\.building/i)).toBeInTheDocument()
  })

  it('falls back to plan.title when plan.app_name is empty', () => {
    const plan: WorkflowGenPlan = {
      app_name: '',
      title: 'Fallback Title',
      mode: 'workflow',
      nodes: [],
      start_inputs: [],
    } as unknown as WorkflowGenPlan
    render(<GenerationPlan plan={plan} />)

    expect(screen.getByText('Fallback Title')).toBeInTheDocument()
  })
})
