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

  it('should disable both actions while apply is pending', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    const onDiscard = vi.fn()

    render(
      <AgentBuildDraftBar
        changesCount={1}
        isApplying
        onApply={onApply}
        onDiscard={onDiscard}
      />,
    )

    const applyButton = screen.getByRole('button', { name: 'custom.apply' })
    const discardButton = screen.getByRole('button', { name: 'agentV2.agentDetail.configure.buildDraft.discard' })

    expect(applyButton).toHaveAttribute('aria-disabled', 'true')
    expect(applyButton.querySelector('[aria-hidden="true"]')).toBeInTheDocument()
    expect(discardButton).toBeDisabled()

    await user.click(applyButton)
    await user.click(discardButton)

    expect(onApply).not.toHaveBeenCalled()
    expect(onDiscard).not.toHaveBeenCalled()
  })

  it('should disable both actions while discard is pending', () => {
    render(
      <AgentBuildDraftBar
        changesCount={1}
        isDiscarding
        onApply={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'custom.apply' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.buildDraft.discard' })).toBeDisabled()
  })

  it('should not show build draft change metadata', () => {
    const { rerender } = render(
      <AgentBuildDraftBar
        changesCount={0}
        onApply={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )

    expect(screen.getByText('agentV2.agentDetail.configure.buildDraft.title')).toBeInTheDocument()
    expect(screen.getAllByText(/^agentV2\.agentDetail\.configure\.buildDraft\./)).toHaveLength(2)

    rerender(
      <AgentBuildDraftBar
        changesCount={2}
        onApply={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )

    expect(screen.getByText('agentV2.agentDetail.configure.buildDraft.title')).toBeInTheDocument()
    expect(screen.getAllByText(/^agentV2\.agentDetail\.configure\.buildDraft\./)).toHaveLength(2)
  })

  it('should keep both actions enabled when there are no build draft changes', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    const onDiscard = vi.fn()

    render(
      <AgentBuildDraftBar
        changesCount={0}
        onApply={onApply}
        onDiscard={onDiscard}
      />,
    )

    const discardButton = screen.getByRole('button', { name: 'agentV2.agentDetail.configure.buildDraft.discard' })
    const applyButton = screen.getByRole('button', { name: 'custom.apply' })
    const buttons = screen.getAllByRole('button')

    expect(buttons[0]).toBe(discardButton)
    expect(buttons[1]).toBe(applyButton)
    expect(discardButton).toBeEnabled()
    expect(applyButton).toBeEnabled()

    await user.click(discardButton)
    await user.click(applyButton)

    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledTimes(1)
  })
})
