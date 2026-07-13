import type { AgentBuildDraftChangeSummary } from '../build-draft-changes-context'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentBuildDraftBar } from '../build-draft-bar'

const changeSummary: AgentBuildDraftChangeSummary = {
  changedKeys: ['skills', 'files', 'envVariables'],
  changesCount: 5,
  skills: [
    { id: 'skill-1', name: 'tender-analyzer', operation: 'added' },
    { id: 'skill-2', name: 'figma-code-connect', operation: 'removed' },
  ],
  files: [
    {
      id: '__agent_config_build_note__',
      name: 'build_note.md',
      operation: 'updated',
      icon: 'markdown',
      descriptionKey: 'agentDetail.configure.buildDraft.buildNoteDescription',
    },
    { id: 'file-1', name: 'index.json', operation: 'added', icon: 'json' },
  ],
  envVariables: [{ id: 'env-1', name: 'API_KEY', operation: 'updated' }],
}

describe('AgentBuildDraftBar', () => {
  it('should disable both build draft actions when the bar is disabled', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    const onDiscard = vi.fn()

    render(<AgentBuildDraftBar changesCount={1} disabled onApply={onApply} onDiscard={onDiscard} />)

    const applyButton = screen.getByRole('button', { name: 'custom.apply' })
    const discardButton = screen.getByRole('button', {
      name: 'agentV2.agentDetail.configure.buildDraft.discard',
    })

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
      <AgentBuildDraftBar changesCount={1} isApplying onApply={onApply} onDiscard={onDiscard} />,
    )

    const applyButton = screen.getByRole('button', { name: 'custom.apply' })
    const discardButton = screen.getByRole('button', {
      name: 'agentV2.agentDetail.configure.buildDraft.discard',
    })

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
      <AgentBuildDraftBar changesCount={1} isDiscarding onApply={vi.fn()} onDiscard={vi.fn()} />,
    )

    expect(screen.getByRole('button', { name: 'custom.apply' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'agentV2.agentDetail.configure.buildDraft.discard' }),
    ).toBeDisabled()
  })

  it('should show build draft change metadata', () => {
    const { container, rerender } = render(
      <AgentBuildDraftBar
        changeSummary={changeSummary}
        changesCount={0}
        onApply={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )

    expect(container.firstElementChild).toHaveClass('w-full')
    expect(container.firstElementChild).not.toHaveClass('w-fit')
    expect(screen.getByText('agentV2.agentDetail.configure.buildDraft.title')).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.buildDraft.changesToApply:{"count":0}',
      }),
    ).toBeInTheDocument()
    expect(document.querySelector('.i-ri-arrow-right-s-line')).toBeInTheDocument()

    rerender(
      <AgentBuildDraftBar
        changeSummary={changeSummary}
        changesCount={2}
        onApply={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )

    expect(screen.getByText('agentV2.agentDetail.configure.buildDraft.title')).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.buildDraft.changesToApply:{"count":2}',
      }),
    ).toBeInTheDocument()
  })

  it('should open build draft change details from the metadata trigger', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    const onDiscard = vi.fn()
    const getBoundingClientRectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({
        bottom: 50,
        height: 50,
        left: 0,
        right: 432,
        top: 0,
        width: 432,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      })

    render(
      <AgentBuildDraftBar
        changeSummary={changeSummary}
        changesCount={5}
        onApply={onApply}
        onDiscard={onDiscard}
      />,
    )

    const changesTrigger = screen.getByRole('button', {
      name: 'agentV2.agentDetail.configure.buildDraft.changesToApply:{"count":5}',
    })

    await user.click(changesTrigger)

    const changesPanelId = changesTrigger.getAttribute('aria-controls')
    expect(changesPanelId).toBeTruthy()
    expect(document.getElementById(changesPanelId!)).toHaveStyle({ width: '432px' })
    expect(screen.getByText('agentV2.agentDetail.configure.skills.label')).toBeInTheDocument()
    expect(screen.getByText('tender-analyzer')).toBeInTheDocument()
    expect(screen.getByText('figma-code-connect')).toBeInTheDocument()
    expect(screen.getByText('build_note.md')).toBeInTheDocument()
    expect(
      screen.getByText('agentV2.agentDetail.configure.buildDraft.buildNoteDescription'),
    ).toBeInTheDocument()
    expect(screen.getByText('index.json')).toBeInTheDocument()
    expect(
      screen.getByText('agentV2.agentDetail.configure.advancedSettings.envEditor.shortLabel'),
    ).toBeInTheDocument()
    expect(screen.getByText('API_KEY')).toBeInTheDocument()
    expect(document.querySelector('.text-text-accent')).toHaveClass('i-ri-add-circle-fill')

    await user.click(
      screen.getByRole('button', { name: 'agentV2.agentDetail.configure.buildDraft.discard' }),
    )
    expect(onDiscard).not.toHaveBeenCalled()
    expect(
      screen.getByRole('alertdialog', {
        name: 'agentV2.agentDetail.configure.clearSessionConfirm.title',
      }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    await user.click(screen.getByRole('button', { name: 'custom.apply' }))

    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledTimes(1)

    getBoundingClientRectSpy.mockRestore()
  })

  it('should keep both actions enabled when there are no build draft changes', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    const onDiscard = vi.fn()

    render(<AgentBuildDraftBar changesCount={0} onApply={onApply} onDiscard={onDiscard} />)

    const discardButton = screen.getByRole('button', {
      name: 'agentV2.agentDetail.configure.buildDraft.discard',
    })
    const applyButton = screen.getByRole('button', { name: 'custom.apply' })

    expect(discardButton).toBeEnabled()
    expect(applyButton).toBeEnabled()

    await user.click(discardButton)
    expect(onDiscard).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    await user.click(applyButton)

    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledTimes(1)
  })
})
