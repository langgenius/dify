import { useState } from 'react'
import { render } from 'vitest-browser-react'
import { ReindexConfirmDialog } from '../reindex-confirm-dialog'

// With its animations on, the popup is still on screen (and clickable) after it was closed.
beforeEach(() => vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false))
afterEach(() => vi.unstubAllGlobals())

it('starts one reindex when confirm is pressed again while the dialog closes', async () => {
  const onConfirm = vi.fn()
  function Harness() {
    const [open, setOpen] = useState(true)
    return <ReindexConfirmDialog open={open} onOpenChange={setOpen} onConfirm={onConfirm} />
  }
  const screen = await render(<Harness />)
  const confirm = screen.getByRole('button', { name: 'knowledgeDocuments.reindexDocument' })
  await expect.element(confirm).toBeVisible()
  const button = confirm.element()
  if (!(button instanceof HTMLElement))
    throw new TypeError('The confirm button is not an HTML element')

  // Two presses are two events, with the first already rendered when the second arrives.
  button.click()
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  expect(button.isConnected).toBe(true)
  button.click()

  expect(onConfirm).toHaveBeenCalledTimes(1)
})
