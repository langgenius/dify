import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentBuildDraftBar } from '../build-draft-bar'

describe('AgentBuildDraftBar', () => {
  it('should disable both build draft actions when the bar is disabled', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    const onDiscard = vi.fn()

    render(
      <AgentBuildDraftBar
        changesCount={1}
        disabled
        onApply={onApply}
        onDiscard={onDiscard}
      />,
    )

    const applyButton = screen.getByRole('button', { name: 'custom.apply' })
    const discardButton = screen.getByRole('button', { name: 'agentV2.agentDetail.configure.buildDraft.discard' })

    expect(applyButton).toBeDisabled()
    expect(discardButton).toBeDisabled()

    await user.click(applyButton)
    await user.click(discardButton)

    expect(onApply).not.toHaveBeenCalled()
    expect(onDiscard).not.toHaveBeenCalled()
  })

  it('should keep discard disabled while apply is pending', () => {
    render(
      <AgentBuildDraftBar
        changesCount={1}
        isApplying
        onApply={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'custom.apply' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.buildDraft.discard' })).toBeDisabled()
  })

  it('should keep apply disabled while discard is pending', () => {
    render(
      <AgentBuildDraftBar
        changesCount={1}
        isDiscarding
        onApply={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'custom.apply' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.buildDraft.discard' })).toHaveAttribute('aria-disabled', 'true')
  })
})
