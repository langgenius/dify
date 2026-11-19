import { Dialog, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDeferred } from '@/test/deferred'
import { ExternalDataToolDialogContent } from '../external-data-tool-dialog-content'

const chunk = createDeferred()
vi.mock('../external-data-tool-modal', async () => {
  await chunk.promise
  return { default: () => <input aria-label="Tool name" /> }
})

it('keeps focus inside the named dialog while the tool form loads', async () => {
  const user = userEvent.setup()
  render(
    <>
      <Dialog>
        <DialogTrigger>Open tool</DialogTrigger>
        <ExternalDataToolDialogContent onSave={vi.fn()} isVariableUsed={() => false} />
      </Dialog>
      <button>Background action</button>
    </>,
  )
  await user.click(screen.getByRole('button', { name: 'Open tool' }))
  const dialog = await screen.findByRole('dialog', { name: /variableConfig.apiBasedVar/ })
  await user.tab()
  expect(dialog.contains(document.activeElement)).toBe(true)
  chunk.resolve()
  expect(await screen.findByRole('textbox', { name: 'Tool name' })).toBeVisible()
})
