import { toast } from '@langgenius/dify-ui/toast'
import { fireEvent, render, screen } from '@testing-library/react'
import { AgentDetailLayout } from '../layout'

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: vi.fn(),
  },
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

describe('AgentDetailLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the detail shell without feature data', () => {
    render(
      <AgentDetailLayout agentId="agent-1">
        <section aria-label="content" />
      </AgentDetailLayout>,
    )

    expect(screen.getByRole('heading', { name: 'agentV2.agentDetail.title' })).toBeInTheDocument()
    expect(screen.getByText(/agentV2\.agentDetail\.subtitle/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agentV2.agentDetail.publish' })).toBeEnabled()
    expect(screen.getByLabelText('content')).toBeInTheDocument()
  })

  it('shows publish menu actions from the publish button', async () => {
    render(
      <AgentDetailLayout agentId="agent-1">
        <section aria-label="content" />
      </AgentDetailLayout>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'agentV2.agentDetail.publish' }))

    expect(await screen.findByText('agentV2.agentDetail.publishMenu.publishUpdate')).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.publishMenu.publishUpdateDescription')).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.publishMenu.saveAsNewAgent')).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.publishMenu.saveAsNewAgentDescription')).toBeInTheDocument()
  })

  it('shows success toast when publish menu actions are clicked', async () => {
    render(
      <AgentDetailLayout agentId="agent-1">
        <section aria-label="content" />
      </AgentDetailLayout>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'agentV2.agentDetail.publish' }))
    fireEvent.click(await screen.findByText('agentV2.agentDetail.publishMenu.publishUpdate'))

    expect(toast.success).toHaveBeenCalledWith('common.api.success')

    fireEvent.click(screen.getByRole('button', { name: 'agentV2.agentDetail.publish' }))
    fireEvent.click(await screen.findByText('agentV2.agentDetail.publishMenu.saveAsNewAgent'))

    expect(toast.success).toHaveBeenCalledTimes(2)
    expect(toast.success).toHaveBeenLastCalledWith('common.api.success')
  })

  it('opens mock version history from the history button', () => {
    render(
      <AgentDetailLayout agentId="agent-1">
        <section aria-label="content" />
      </AgentDetailLayout>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.versionHistory' }))

    expect(screen.getByText('workflow.versionHistory.title')).toBeInTheDocument()
    expect(screen.getByText('workflow.versionHistory.currentDraft')).toBeInTheDocument()
    expect(screen.getByText('v1.4.0 Handoff rules')).toBeInTheDocument()
    expect(screen.getByText('Aligned escalation handoff rules and response boundaries.')).toBeInTheDocument()
    expect(screen.getByText('workflow.versionHistory.latest')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(screen.queryByText('workflow.versionHistory.title')).not.toBeInTheDocument()
  })
})
