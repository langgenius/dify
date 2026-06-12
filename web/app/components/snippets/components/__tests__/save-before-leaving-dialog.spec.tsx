import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expectLoadingButton } from '@/test/button'
import SaveBeforeLeavingDialog from '../save-before-leaving-dialog'

describe('SaveBeforeLeavingDialog', () => {
  it('should render the trigger and call discard or save actions', async () => {
    const user = userEvent.setup()
    const onDiscard = vi.fn()
    const onSave = vi.fn()

    render(
      <SaveBeforeLeavingDialog
        open
        trigger={<button type="button">leave snippet</button>}
        onDiscard={onDiscard}
        onSave={onSave}
      />,
    )

    expect(screen.getByText('snippet.saveBeforeLeavingTitle')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'snippet.doNotSave' }))
    await user.click(screen.getByRole('button', { name: 'snippet.saveAndExit' }))

    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('should disable destructive and save actions according to dialog state', () => {
    render(
      <SaveBeforeLeavingDialog
        open
        disabled
        saveDisabled
        loading
        onDiscard={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'snippet.continueEditing' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'snippet.doNotSave' })).toBeDisabled()
    expectLoadingButton(screen.getByRole('button', { name: 'snippet.saveAndExit' }))
  })
})
