import { createToast, createToastManager } from '@langgenius/dify-ui/toast'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AppToastHost } from '../host'

// Real CSS and pointer hit testing prove the hidden floating action can be discovered
// and clicked without overflowing the card or starting swipe-to-dismiss.
it('reveals a contained copy action on hover at 360px and keeps the card open after copying', async () => {
  await page.viewport(360, 800)
  const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
  const manager = createToastManager()
  const toast = createToast(manager)
  try {
    const screen = await render(
      <>
        <button type="button" style={{ position: 'fixed', bottom: 16, left: 16 }}>
          Outside notifications
        </button>
        <AppToastHost manager={manager} timeout={0} />
      </>,
    )
    const outside = screen.getByRole('button', { name: 'Outside notifications' })
    await userEvent.hover(outside)
    toast.error('Upload failed', {
      description: 'Storage connection refused. Please retry the request.',
    })
    const card = screen.getByRole('dialog', { name: 'Upload failed' })
    const copy = screen.getByRole('button', { name: 'common.operation.copyErrorDetails' })
    await expect.element(copy).toHaveStyle({ opacity: '0' })
    await userEvent.hover(card)
    await expect.element(copy).toHaveStyle({ opacity: '1' })
    const cardBounds = card.element().getBoundingClientRect()
    const buttonBounds = copy.element().getBoundingClientRect()
    expect(buttonBounds.left).toBeGreaterThanOrEqual(cardBounds.left)
    expect(buttonBounds.right).toBeLessThanOrEqual(cardBounds.right)
    expect(buttonBounds.top).toBeGreaterThanOrEqual(cardBounds.top)
    expect(buttonBounds.bottom).toBeLessThanOrEqual(cardBounds.bottom)
    await userEvent.click(copy)
    await expect
      .element(screen.getByRole('button', { name: 'common.operation.copied' }))
      .toHaveStyle({ opacity: '1' })
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      'Upload failed\nStorage connection refused. Please retry the request.',
    )
    await expect.element(card).toBeInTheDocument()
    await userEvent.hover(outside)
    await expect
      .element(screen.getByRole('button', { name: 'common.operation.copied' }))
      .toHaveStyle({ opacity: '0' })
    await userEvent.hover(card)
    await userEvent.click(screen.getByRole('button', { name: 'Close notification' }))
    await expect.element(card).not.toBeInTheDocument()
  } finally {
    toast.dismiss()
    writeText.mockRestore()
    await page.viewport(1280, 720)
  }
})

it('reveals the action for keyboard focus and supports reverse tabbing', async () => {
  const manager = createToastManager()
  const toast = createToast(manager)
  try {
    const screen = await render(<AppToastHost manager={manager} timeout={0} />)
    toast.error('Keyboard error')
    const card = screen.getByRole('dialog', { name: 'Keyboard error' })
    const copy = screen.getByRole('button', { name: 'common.operation.copyErrorDetails' })
    await expect.element(copy).toHaveStyle({ opacity: '0' })
    await userEvent.keyboard('{F6}')
    await expect.element(screen.getByRole('region', { name: 'Notifications' })).toHaveFocus()
    await userEvent.keyboard('{Tab}')
    await expect.element(card).toHaveFocus()
    await expect.element(copy).toHaveStyle({ opacity: '1' })
    await userEvent.keyboard('{Tab}')
    await expect.element(copy).toHaveFocus()
    await expect.element(copy).toHaveStyle({ opacity: '1' })
    await userEvent.keyboard('{Tab}')
    await expect.element(screen.getByRole('button', { name: 'Close notification' })).toHaveFocus()
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    await expect.element(copy).toHaveFocus()
  } finally {
    toast.dismiss()
  }
})
