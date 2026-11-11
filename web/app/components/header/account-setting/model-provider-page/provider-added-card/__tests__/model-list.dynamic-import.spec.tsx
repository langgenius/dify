import { act, screen, waitFor } from '@testing-library/react'
import { toast } from '@/app/notifications'
import { dialogName, renderModelList } from './model-list-test-env'

// Keep the model row and its configuration action real; only module loading fails.
vi.mock('../model-load-balancing-modal', () => {
  throw new Error('Failed to load model load balancing modal')
})

afterEach(() => act(() => toast.dismiss()))

it('clears the loading dialog and reports an error when the modal module cannot load', async () => {
  const { user } = renderModelList()
  await user.click(screen.getAllByRole('button', { name: 'common.operation.config' })[0]!)

  expect(await screen.findByText('common.api.actionFailed')).toBeVisible()
  await waitFor(() => {
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: dialogName })).not.toBeInTheDocument()
  })
  expect(screen.getAllByRole('button', { name: 'common.operation.config' })[0]).toBeEnabled()
})
