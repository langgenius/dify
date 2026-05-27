import { render, screen } from '@testing-library/react'
import { AgentDetailLayout } from '../layouts/agent-detail-layout'

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

describe('AgentDetailLayout', () => {
  it('renders the detail shell without feature data', () => {
    render(
      <AgentDetailLayout agentId="agent-1">
        <section aria-label="content" />
      </AgentDetailLayout>,
    )

    expect(screen.getByRole('heading', { name: 'agentV2.agentDetail.title' })).toBeInTheDocument()
    expect(screen.getByText(/agentV2\.agentDetail\.subtitle/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agentV2.agentDetail.publish' })).toBeDisabled()
    expect(screen.getByLabelText('content')).toBeInTheDocument()
  })
})
