import { Dialog, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDeferred } from '@/test/deferred'
import { ExternalApiDialogContent } from '../dialog-content'

const chunk = createDeferred<void>()
vi.mock('../index', async () => {
  await chunk.promise
  return { default: () => <input aria-label="API name" /> }
})

it('keeps focus inside the dialog while the editor code is loading', async () => {
  const user = userEvent.setup()
  render(
    <Dialog>
      <DialogTrigger>Edit API</DialogTrigger>
      <ExternalApiDialogContent pending={false} onSubmit={vi.fn()} />
    </Dialog>,
  )
  await user.click(screen.getByRole('button', { name: 'Edit API' }))
  expect(await screen.findByRole('dialog', { name: 'dataset.createExternalAPI' })).toBeVisible()
  await user.tab()
  expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
  chunk.resolve()
  expect(await screen.findByRole('textbox', { name: 'API name' })).toBeVisible()
  expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
})
