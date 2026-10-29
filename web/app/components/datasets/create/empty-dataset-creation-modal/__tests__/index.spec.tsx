import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createEmptyDataset } from '@/service/datasets'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import EmptyDatasetCreationModal from '../index'

const { mockNotify, mockToast } = vi.hoisted(() => {
  const mockNotify = vi.fn()
  const mockToast = Object.assign(mockNotify, {
    success: vi.fn((message, options) => mockNotify({ type: 'success', message, ...options })),
    error: vi.fn((message, options) => mockNotify({ type: 'error', message, ...options })),
    warning: vi.fn((message, options) => mockNotify({ type: 'warning', message, ...options })),
    info: vi.fn((message, options) => mockNotify({ type: 'info', message, ...options })),
    dismiss: vi.fn(),
    update: vi.fn(),
    promise: vi.fn(),
  })
  return { mockNotify, mockToast }
})

vi.mock('@/app/notifications', () => ({
  toast: mockToast,
}))

// Mock Next.js router
const mockPush = vi.fn()
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

// Mock createEmptyDataset API
vi.mock('@/service/datasets', () => ({
  createEmptyDataset: vi.fn(),
}))

const dataset = createDatasetFixture({ id: 'created-dataset', name: 'New Dataset' })
const listKey = consoleQuery.datasets.get.queryKey({ input: { query: { page: 1, limit: 20 } } })
const mockCreate = vi.mocked(createEmptyDataset)
const field = () => screen.getByRole('textbox', { name: 'datasetCreation.stepOne.modal.input' })
const confirm = () =>
  screen.getByRole('button', { name: 'datasetCreation.stepOne.modal.confirmButton' })
function setup() {
  const onHide = vi.fn()
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(listKey, { data: [], page: 1, limit: 20, total: 0, has_more: false })
  return {
    onHide,
    ...renderWithConsoleQuery(<EmptyDatasetCreationModal show onHide={onHide} />, { queryClient }),
  }
}
beforeEach(() => mockCreate.mockReset().mockResolvedValue(dataset))

it.each(['', 'A'.repeat(41)])('rejects invalid name length %s before submitting', async (name) => {
  const user = userEvent.setup()
  const { onHide, queryClient } = setup()
  if (name) await user.type(field(), name)
  await user.click(confirm())
  expect(mockNotify).toHaveBeenCalledWith({
    type: 'error',
    message: `datasetCreation.stepOne.modal.${name ? 'nameLengthInvalid' : 'nameNotEmpty'}`,
  })
  expect(mockCreate).not.toHaveBeenCalled()
  expect(onHide).not.toHaveBeenCalled()
  expect(mockPush).not.toHaveBeenCalled()
  expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false)
})

it('creates a name at the length limit, invalidates the list and opens its documents', async () => {
  const user = userEvent.setup()
  const { onHide, queryClient } = setup()
  const name = 'A'.repeat(40)
  await user.type(field(), name)
  await user.click(confirm())
  await waitFor(() => expect(onHide).toHaveBeenCalledOnce())
  expect(mockCreate).toHaveBeenCalledExactlyOnceWith({ name })
  expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true)
  expect(mockPush).toHaveBeenCalledExactlyOnceWith('/datasets/created-dataset/documents')
})

it('submits with Enter and prevents duplicate requests until creation completes', async () => {
  const user = userEvent.setup()
  const pending = createDeferred<typeof dataset>()
  mockCreate.mockReturnValueOnce(pending.promise)
  const { onHide } = setup()
  await user.type(field(), 'New Dataset{Enter}')
  await user.keyboard('{Enter}')
  await user.click(confirm())
  expect(mockCreate).toHaveBeenCalledExactlyOnceWith({ name: 'New Dataset' })
  expect(onHide).not.toHaveBeenCalled()
  await act(async () => pending.resolve(dataset))
  await waitFor(() => expect(onHide).toHaveBeenCalledOnce())
})

it('keeps a failed draft available for retry without navigating or invalidating the list', async () => {
  const user = userEvent.setup()
  mockCreate.mockRejectedValueOnce(new Error('offline'))
  const { onHide, queryClient } = setup()
  await user.type(field(), 'Retry me')
  await user.click(confirm())
  await waitFor(() =>
    expect(mockNotify).toHaveBeenCalledWith({
      type: 'error',
      message: 'datasetCreation.stepOne.modal.failed',
    }),
  )
  expect(field()).toHaveValue('Retry me')
  expect(onHide).not.toHaveBeenCalled()
  expect(mockPush).not.toHaveBeenCalled()
  expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false)
  await user.click(confirm())
  await waitFor(() => expect(onHide).toHaveBeenCalledOnce())
  expect(mockCreate).toHaveBeenCalledTimes(2)
})

it.each(['datasetCreation.stepOne.modal.cancelButton', 'common.operation.close'])(
  'closes through %s without creating a dataset',
  async (name) => {
    const user = userEvent.setup()
    const { onHide } = setup()
    await user.type(field(), 'Draft')
    await user.click(screen.getByRole('button', { name }))
    expect(onHide).toHaveBeenCalledOnce()
    expect(mockCreate).not.toHaveBeenCalled()
  },
)

it('preserves the unsaved name after the modal is hidden and reopened', async () => {
  const user = userEvent.setup()
  const { onHide, rerender } = setup()
  await user.type(field(), 'Draft')
  rerender(<EmptyDatasetCreationModal show={false} onHide={onHide} />)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  rerender(<EmptyDatasetCreationModal show onHide={onHide} />)
  expect(
    await screen.findByRole('textbox', { name: 'datasetCreation.stepOne.modal.input' }),
  ).toHaveValue('Draft')
})
