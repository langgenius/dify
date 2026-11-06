import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateAppDialogShell } from '../create-app-dialog-shell'

function renderInline(onClose = vi.fn()) {
  const view = render(
    <>
      <button type="button">Behind the dialog</button>
      <CreateAppDialogShell inline show title="Create from Blank" onClose={onClose}>
        <input aria-label="App name" />
        <button type="button">Create</button>
        {/* Disabled controls can keep a tabindex, but focus cannot land on them. */}
        <button type="button" tabIndex={0} disabled>
          Create disabled
        </button>
      </CreateAppDialogShell>
      <div role="dialog" aria-label="Icon picker">
        <button type="button">Pick icon</button>
      </div>
    </>,
  )
  return { ...view, onClose, user: userEvent.setup() }
}

// Rendered in place for server rendering, the frame still behaves like the portal dialog.
describe('CreateAppDialogShell inline', () => {
  it('is a labelled modal dialog that takes focus', () => {
    renderInline()
    const dialog = screen.getByRole('dialog', { name: 'Create from Blank' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
  })

  it('closes on Escape', async () => {
    const { onClose, user } = renderInline()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('leaves Escape to popups it opened', async () => {
    const { onClose, user } = renderInline()
    screen.getByRole('button', { name: 'Pick icon' }).focus()
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps Tab focus inside the dialog', async () => {
    const { user } = renderInline()
    const close = screen.getByRole('button', { name: 'Close' })
    const create = screen.getByRole('button', { name: 'Create' })

    await user.tab({ shift: true })
    expect(create).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('textbox', { name: 'App name' })).toHaveFocus()
  })

  it('locks page scroll while open', () => {
    document.body.style.overflow = 'auto'
    const { unmount } = renderInline()
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('auto')
  })
})
