import { render, screen } from '@testing-library/react'
import { AgentOrchestrateHeader } from '../header'

describe('AgentOrchestrateHeader', () => {
  it('should render configure title without build mode copy by default', () => {
    render(<AgentOrchestrateHeader headingId="configure-heading" />)

    expect(screen.getByRole('heading', { name: 'agentV2.agentDetail.configure.title' })).toBeInTheDocument()
    expect(screen.queryByText('agentV2.agentDetail.configure.buildDraft.modeBadge')).not.toBeInTheDocument()
  })

  it('should render build mode copy when build draft is active', () => {
    render(<AgentOrchestrateHeader headingId="configure-heading" isBuildDraftActive />)

    expect(screen.getByText('agentV2.agentDetail.configure.buildDraft.modeBadge')).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.configure.buildDraft.modeDescription')).toBeInTheDocument()
  })

  it('should render trailing action on the configure title row', () => {
    render(
      <AgentOrchestrateHeader
        headingId="configure-heading"
        trailingAction={<button type="button">More actions</button>}
      />,
    )

    expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument()
  })
})
