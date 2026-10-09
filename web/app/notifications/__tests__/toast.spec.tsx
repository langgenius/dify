import { createToast, createToastManager } from '@langgenius/dify-ui/toast'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppToastHost } from '../host'

const copy = vi.fn()

function setup() {
  const manager = createToastManager()
  const toast = createToast(manager)
  render(<AppToastHost manager={manager} timeout={0} />)
  const user = userEvent.setup()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } })
  return { toast, user }
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) })
  vi.mocked(copy).mockResolvedValue(undefined)
})

it('copies the complete error text and shows feedback in the existing action', async () => {
  const { toast, user } = setup()
  act(() => {
    toast.error('Upload failed', { description: 'Storage unavailable' })
  })
  await user.click(await screen.findByRole('button', { name: 'common.operation.copyErrorDetails' }))
  expect(copy).toHaveBeenCalledExactlyOnceWith('Upload failed\nStorage unavailable')
  expect(await screen.findByRole('button', { name: 'common.operation.copied' })).toBeInTheDocument()
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
})

it('preserves caller actions and does not extract rich content', async () => {
  const { toast, user } = setup()
  const retry = vi.fn()
  act(() => {
    toast.error('Retryable', { actionProps: { children: 'Retry', onClick: retry } })
    toast.error(<strong>Rich error</strong>)
  })
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(retry).toHaveBeenCalledOnce()
  await user.click(screen.getByRole('button', { name: 'common.operation.copyErrorDetails' }))
  expect(copy).toHaveBeenCalledWith('Retryable')
  expect(
    within(screen.getByRole('dialog', { name: 'Rich error' })).queryByRole('button', {
      name: 'common.operation.copyErrorDetails',
    }),
  ).not.toBeInTheDocument()
})

it('updates copy content and removes generated actions when the tone changes', async () => {
  const { toast, user } = setup()
  let id = ''
  act(() => {
    id = toast('First error', { type: 'error' })
  })
  act(() => {
    toast.update(id, { title: 'Updated error' })
  })
  await user.click(screen.getByRole('button', { name: 'common.operation.copyErrorDetails' }))
  expect(copy).toHaveBeenCalledWith('Updated error')
  act(() => {
    toast.update(id, { type: 'success', title: 'Recovered' })
  })
  expect(screen.queryByRole('button', { name: 'common.operation.copied' })).not.toBeInTheDocument()
})

it('does not let an old clipboard result change an upserted error', async () => {
  let finish!: () => void
  vi.mocked(copy).mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve
    }),
  )
  const { toast, user } = setup()
  act(() => {
    toast.error('Old error', { id: 'request' })
  })
  await user.click(screen.getByRole('button', { name: 'common.operation.copyErrorDetails' }))
  act(() => {
    toast.error('New error', { id: 'request' })
  })
  await act(async () => {
    finish()
  })
  expect(screen.queryByRole('button', { name: 'common.operation.copied' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.copyErrorDetails' }))
  expect(copy).toHaveBeenLastCalledWith('New error')
})

it('allows retrying a rejected clipboard operation without another toast', async () => {
  vi.mocked(copy).mockRejectedValueOnce(new Error('Denied'))
  const { toast, user } = setup()
  act(() => {
    toast.error('Network error')
  })
  await user.click(screen.getByRole('button', { name: 'common.operation.copyErrorDetails' }))
  await user.click(await screen.findByRole('button', { name: 'common.operation.copyErrorFailed' }))
  expect(await screen.findByRole('button', { name: 'common.operation.copied' })).toBeInTheDocument()
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
})

it('decorates a rejected promise and preserves the original rejection', async () => {
  const { toast, user } = setup()
  const error = new Error('Export failed')
  await act(async () => {
    await expect(
      toast.promise(Promise.reject(error), {
        loading: 'Exporting',
        success: 'Exported',
        error: (reason) => ({ title: (reason as Error).message, description: 'Try again later' }),
      }),
    ).rejects.toBe(error)
  })
  await user.click(screen.getByRole('button', { name: 'common.operation.copyErrorDetails' }))
  expect(copy).toHaveBeenCalledWith('Export failed\nTry again later')
})

it('keeps scoped managers isolated from each other', async () => {
  const first = createToastManager()
  const second = createToastManager()
  const firstToast = createToast(first)
  const secondToast = createToast(second)
  render(
    <>
      <AppToastHost manager={first} timeout={0} />
      <AppToastHost manager={second} timeout={0} />
    </>,
  )
  act(() => {
    firstToast.error('First')
    secondToast.error('Second')
  })
  const regions = screen.getAllByRole('region', { name: 'Notifications' })
  expect(within(regions[0]!).getByRole('dialog', { name: 'First' })).toBeInTheDocument()
  expect(within(regions[0]!).queryByText('Second')).not.toBeInTheDocument()
  act(() => {
    firstToast.dismiss()
  })
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'First' })).not.toBeInTheDocument(),
  )
  expect(screen.getByRole('dialog', { name: 'Second' })).toBeInTheDocument()
})

it('copies the retained description after a same-id title-only upsert', async () => {
  const { toast, user } = setup()
  act(() => {
    toast.error('First', { id: 'request', description: 'Diagnostic details' })
  })
  act(() => {
    toast.error('Second', { id: 'request' })
  })
  await user.click(screen.getByRole('button', { name: 'common.operation.copyErrorDetails' }))
  expect(copy).toHaveBeenCalledWith('Second\nDiagnostic details')
})

it('retains a caller action across upserts and promise failure', async () => {
  const { toast, user } = setup()
  const retry = vi.fn()
  const actionProps = { children: 'Retry', onClick: retry }
  act(() => {
    toast.error('First', { id: 'request', actionProps })
  })
  act(() => {
    toast.error('Second', { id: 'request' })
  })
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(retry).toHaveBeenCalledOnce()
  await act(async () => {
    await toast
      .promise(Promise.reject(new Error('Failed')), {
        loading: { title: 'Loading', actionProps: { children: 'Details', onClick: retry } },
        success: 'Done',
        error: 'Failed',
      })
      .catch(() => {})
  })
  const failedToast = screen.getByRole('dialog', { name: 'Loading' })
  await user.click(
    within(failedToast).getByRole('button', { name: 'common.operation.copyErrorDetails' }),
  )
  expect(copy).toHaveBeenCalledWith('Loading\nFailed')
  await user.click(screen.getByRole('button', { name: 'Details' }))
  expect(retry).toHaveBeenCalledTimes(2)
})

it('copies the resolved string description without retaining loading text', async () => {
  const { toast, user } = setup()
  await act(async () => {
    await toast
      .promise(Promise.reject(new Error('Failed')), {
        loading: 'Loading',
        success: 'Done',
        error: () => 'Failed',
      })
      .catch(() => {})
  })
  expect(screen.queryByText('Loading')).not.toBeInTheDocument()
  expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.copyErrorDetails' }))
  expect(copy).toHaveBeenCalledWith('Failed')
})
