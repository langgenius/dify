import { createToast, createToastManager } from '@langgenius/dify-ui/toast'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AppToastHost } from '../host'

// Use the real clipboard adapter and browser focus order: the copy action must remain
// keyboard-operable, including when the adapter falls back to selection-based copying.
it('copies through the keyboard action and retains focus after feedback', async () => {
  const description = Array.from(
    { length: 20 },
    (_, index) => `Storage request ${index}: connection refused at storage.internal:19000`,
  ).join('\n')
  const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
  const manager = createToastManager()
  const toast = createToast(manager)
  try {
    const screen = await render(<AppToastHost manager={manager} timeout={0} />)
    toast.error('Upload failed', { description })
    await expect.element(screen.getByText('Upload failed')).toBeInTheDocument()
    await userEvent.keyboard('{F6}{Tab}{Tab}')
    const action = screen.getByRole('button', { name: 'common.operation.copyErrorDetails' })
    await expect.element(action).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect
      .element(screen.getByRole('button', { name: 'common.operation.copied' }))
      .toHaveFocus()
    expect(writeText).toHaveBeenCalledExactlyOnceWith(`Upload failed\n${description}`)
  } finally {
    toast.dismiss()
    writeText.mockRestore()
  }
})

it('preserves whitespace and action focus when clipboard copying falls back to execCommand', async () => {
  const description = 'First line\n  indented  text\n\ttabbed text'
  let selectedText = ''
  const writeText = vi
    .spyOn(navigator.clipboard, 'writeText')
    .mockRejectedValue(new Error('Denied'))
  const execCommand = vi.spyOn(document, 'execCommand').mockImplementation(() => {
    selectedText = document.getSelection()?.toString() ?? ''
    return true
  })
  const manager = createToastManager()
  const toast = createToast(manager)
  try {
    const screen = await render(<AppToastHost manager={manager} timeout={0} />)
    toast.error('Connection failed', { description })
    await expect.element(screen.getByText('Connection failed')).toBeInTheDocument()
    await userEvent.keyboard('{F6}{Tab}{Tab}{Enter}')
    await expect
      .element(screen.getByRole('button', { name: 'common.operation.copied' }))
      .toHaveFocus()
    expect(execCommand).toHaveBeenCalledExactlyOnceWith('copy')
    expect(selectedText).toBe(`Connection failed\n${description}`)
  } finally {
    toast.dismiss()
    writeText.mockRestore()
    execCommand.mockRestore()
  }
})

it('keeps an accessible focused action when copying fails and is retried with Space', async () => {
  const writeText = vi
    .spyOn(navigator.clipboard, 'writeText')
    .mockRejectedValueOnce(new Error('Denied'))
    .mockResolvedValue(undefined)
  const execCommand = vi.spyOn(document, 'execCommand').mockReturnValue(false)
  const manager = createToastManager()
  const toast = createToast(manager)
  try {
    const screen = await render(<AppToastHost manager={manager} timeout={0} />)
    toast.error('Connection failed')
    await expect.element(screen.getByText('Connection failed')).toBeInTheDocument()
    await userEvent.keyboard('{F6}{Tab}{Tab}{Enter}')
    await expect
      .element(screen.getByRole('button', { name: 'common.operation.copyErrorFailed' }))
      .toHaveFocus()
    await userEvent.keyboard(' ')
    await expect
      .element(screen.getByRole('button', { name: 'common.operation.copied' }))
      .toHaveFocus()
    expect(writeText).toHaveBeenCalledTimes(2)
    expect(writeText).toHaveBeenLastCalledWith('Connection failed')
  } finally {
    toast.dismiss()
    writeText.mockRestore()
    execCommand.mockRestore()
  }
})

// Updating the card must not remount the focused copy button.
it('retains focus and copies current content after an error update', async () => {
  const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
  const manager = createToastManager()
  const toast = createToast(manager)
  try {
    const screen = await render(<AppToastHost manager={manager} timeout={0} />)
    const id = toast.error('First error')
    await expect.element(screen.getByText('First error')).toBeInTheDocument()
    await userEvent.keyboard('{F6}{Tab}{Tab}{Enter}')
    await expect
      .element(screen.getByRole('button', { name: 'common.operation.copied' }))
      .toHaveFocus()
    toast.update(id, { title: 'Updated error' })
    await expect.element(screen.getByText('Updated error')).toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: 'common.operation.copyErrorDetails' }))
      .toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect
      .element(screen.getByRole('button', { name: 'common.operation.copied' }))
      .toHaveFocus()
    expect(writeText).toHaveBeenLastCalledWith('Updated error')
  } finally {
    toast.dismiss()
    writeText.mockRestore()
  }
})

// Real CSS and pointer hit testing prove the hidden floating action can be discovered
// and clicked without overflowing the card or starting swipe-to-dismiss.
it.each([1280, 360])(
  'reveals a contained copy action on hover at %ipx and keeps the card open after copying',
  async (width) => {
    await page.viewport(width, 800)
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
  },
)

it('reveals the action for keyboard focus, supports reverse tabbing, and restores focus on Escape', async () => {
  const manager = createToastManager()
  const toast = createToast(manager)
  try {
    const screen = await render(
      <>
        <button type="button">Return target</button>
        <AppToastHost manager={manager} timeout={0} />
      </>,
    )
    const target = screen.getByRole('button', { name: 'Return target' })
    await userEvent.click(target)
    toast.error('Keyboard error')
    const card = screen.getByRole('dialog', { name: 'Keyboard error' })
    const copy = screen.getByRole('button', { name: 'common.operation.copyErrorDetails' })
    await expect.element(copy).toHaveStyle({ opacity: '0' })
    await userEvent.keyboard('{F6}{Tab}')
    await expect.element(card).toHaveFocus()
    await expect.element(copy).toHaveStyle({ opacity: '1' })
    await userEvent.keyboard('{Tab}')
    await expect.element(copy).toHaveFocus()
    await expect.element(copy).toHaveStyle({ opacity: '1' })
    await userEvent.keyboard('{Tab}')
    await expect.element(screen.getByRole('button', { name: 'Close notification' })).toHaveFocus()
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    await expect.element(copy).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect.element(card).not.toBeInTheDocument()
    await expect.element(target).toHaveFocus()
  } finally {
    toast.dismiss()
  }
})
