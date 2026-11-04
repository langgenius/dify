import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CompletedDrawer } from '../drawer'

it('keeps the nonmodal chunk panel open for page interactions but allows Escape to close it', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  const onPageAction = vi.fn()
  render(
    <>
      <button type="button" onClick={onPageAction}>
        Page action
      </button>
      <CompletedDrawer open onClose={onClose}>
        <span>Chunk details</span>
      </CompletedDrawer>
    </>,
  )
  expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'false')
  await user.click(screen.getByRole('button', { name: 'Page action' }))
  expect(onPageAction).toHaveBeenCalledOnce()
  expect(onClose).not.toHaveBeenCalled()
  await user.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledOnce()
})
