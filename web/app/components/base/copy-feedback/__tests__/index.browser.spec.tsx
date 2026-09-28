import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { CopyFeedback } from '..'

it('keeps the copied tooltip visible after clicking the copy button', async () => {
  const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)

  try {
    const screen = await render(<CopyFeedback content="test content" />)
    const copyButton = screen.getByRole('button', { name: 'common.operation.copy' })

    await copyButton.hover()
    await expect.element(page.getByText('common.operation.copy')).toBeVisible()
    await copyButton.click()

    await expect.element(page.getByText('common.operation.copied')).toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'common.operation.copied' }))
      .toBeVisible()
    expect(writeText).toHaveBeenCalledExactlyOnceWith('test content')
  } finally {
    writeText.mockRestore()
  }
})
