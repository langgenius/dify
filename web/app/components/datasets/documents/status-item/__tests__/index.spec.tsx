import type { ComponentProps } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import StatusItem from '../index'

const { changeStatus, retryDocuments, toastError } = vi.hoisted(() => ({
  changeStatus: vi.fn(),
  retryDocuments: vi.fn(),
  toastError: vi.fn(),
}))
vi.mock('@/app/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/notifications')>()),
  toast: { error: toastError },
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.documents.status.byAction.batch.patch': changeStatus,
      'datasets.byDatasetId.retry.post': retryDocuments,
    }),
  }
})
const detail = { enabled: true, archived: false, id: 'doc-1' }
const show = (props: Partial<ComponentProps<typeof StatusItem>> = {}) =>
  render(
    <StatusItem
      status="available"
      scene="detail"
      datasetId="dataset-1"
      detail={detail}
      canEdit
      {...props}
    />,
  )
beforeEach(() => {
  vi.clearAllMocks()
  changeStatus.mockResolvedValue({ result: 'success' })
  retryDocuments.mockResolvedValue(undefined)
})
afterEach(() => vi.useRealTimers())

it('discloses the server error without exposing editing controls in the list', async () => {
  const user = userEvent.setup()
  render(<StatusItem status="error" errorMessage="Parse failed" />)
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'datasetDocuments.list.status.error' }))
  expect(await screen.findByRole('dialog')).toHaveTextContent('Parse failed')
})

it.each([
  { status: 'queuing' },
  { status: 'indexing' },
  { status: 'paused' },
  { detail: { ...detail, archived: true } },
  { canEdit: false },
] satisfies Partial<ComponentProps<typeof StatusItem>>[])(
  'prevents status changes for %j',
  async (props) => {
    const user = userEvent.setup()
    show(props)
    const toggle = screen.getByRole('switch')
    expect(toggle).toHaveAttribute('aria-disabled', 'true')
    await user.click(toggle)
    expect(changeStatus).not.toHaveBeenCalled()
  },
)

it.each([
  { enabled: false, action: 'enable' },
  { enabled: true, action: 'disable' },
])('debounces $action and reports the successful operation', async ({ enabled, action }) => {
  const user = userEvent.setup()
  const onUpdate = vi.fn()
  show({ detail: { ...detail, enabled }, onUpdate })
  const toggle = screen.getByRole('switch', { name: 'datasetDocuments.list.status.available' })
  await user.click(toggle)
  await user.click(toggle)
  expect(changeStatus).not.toHaveBeenCalled()
  await waitFor(() =>
    expect(changeStatus).toHaveBeenCalledExactlyOnceWith({
      params: { dataset_id: 'dataset-1', action },
      query: { document_id: ['doc-1'] },
    }),
  )
  expect(onUpdate).toHaveBeenCalledExactlyOnceWith(action)
})

it.each([
  { ...detail, enabled: false },
  { ...detail, archived: true },
])('does not offer recovery without a server retry action for %j', (unrecoverableDetail) => {
  show({ status: 'error', detail: unrecoverableDetail, retryAction: null })

  expect(screen.queryByRole('button', { name: 'dataset.retry' })).not.toBeInTheDocument()
})

it('reports failed status changes without notifying the owner of success', async () => {
  const user = userEvent.setup()
  changeStatus.mockRejectedValueOnce(new Error('Unavailable'))
  const onUpdate = vi.fn()
  show({ detail: { ...detail, enabled: false }, onUpdate })
  await user.click(screen.getByRole('switch'))
  await waitFor(() =>
    expect(toastError).toHaveBeenCalledWith('common.actionMsg.modifiedUnsuccessfully'),
  )
  expect(onUpdate).not.toHaveBeenCalled()
})

it.each([
  {
    action: 'retry' as const,
    expected: () =>
      expect(retryDocuments).toHaveBeenCalledExactlyOnceWith({
        params: { dataset_id: 'dataset-1' },
        body: { document_ids: ['doc-1'] },
      }),
  },
  {
    action: 'enable' as const,
    expected: () =>
      expect(changeStatus).toHaveBeenCalledExactlyOnceWith({
        params: { dataset_id: 'dataset-1', action: 'enable' },
        query: { document_id: ['doc-1'] },
      }),
  },
  {
    action: 'disable' as const,
    expected: () =>
      expect(changeStatus).toHaveBeenCalledExactlyOnceWith({
        params: { dataset_id: 'dataset-1', action: 'disable' },
        query: { document_id: ['doc-1'] },
      }),
  },
  {
    action: 'archive' as const,
    expected: () =>
      expect(changeStatus).toHaveBeenCalledExactlyOnceWith({
        params: { dataset_id: 'dataset-1', action: 'archive' },
        query: { document_id: ['doc-1'] },
      }),
  },
])('dispatches the server-provided $action recovery action', async ({ action, expected }) => {
  const user = userEvent.setup()
  const onUpdate = vi.fn()
  show({ status: 'error', retryAction: action, onUpdate })

  await user.click(screen.getByRole('button', { name: 'dataset.retry' }))

  await waitFor(expected)
  expect(onUpdate).toHaveBeenCalledExactlyOnceWith(action)
})
