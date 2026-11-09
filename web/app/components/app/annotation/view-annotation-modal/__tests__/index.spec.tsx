import type { consoleClient } from '@/service/console'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { List } from '../../list'

const api = vi.hoisted(() => ({
  history: vi.fn<typeof consoleClient.apps.byAppId.annotations.byAnnotationId.hitHistories.get>(),
}))
vi.mock('@/hooks/use-timestamp', () => ({ default: () => ({ formatTime: () => 'Created time' }) }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.annotations.byAnnotationId.hitHistories.get': (input) => api.history(input),
    }),
  }
})
const emptyHistory = { data: [], total: 0, page: 1, limit: 10, has_more: false }
const items = ['a', 'b'].map((id) => ({
  id,
  question: `Question ${id}`,
  answer: `Answer ${id}`,
  hit_count: 0,
}))
function setup() {
  const user = userEvent.setup()
  const view = renderWithConsoleQuery(
    <List
      appId="app-id"
      list={items}
      onEdited={vi.fn()}
      onRemoved={vi.fn()}
      selectedIds={[]}
      onSelectedIdsChange={vi.fn()}
      onBatchDelete={vi.fn()}
    />,
  )
  return { user, ...view }
}
beforeEach(() => {
  api.history.mockResolvedValue(emptyHistory)
})

it('loads history only when selected and preserves the annotation draft when switching tabs', async () => {
  const { user } = setup()
  await user.click(screen.getByRole('button', { name: 'Question a' }))
  expect(api.history).not.toHaveBeenCalled()
  const answer = screen.getByRole('region', { name: 'appAnnotation.editModal.answerName' })
  await user.click(within(answer).getByRole('button', { name: 'common.operation.edit' }))
  const textbox = within(answer).getByRole('textbox')
  await user.clear(textbox)
  await user.type(textbox, 'Unsaved answer')
  await user.click(screen.getByRole('tab', { name: 'appAnnotation.viewModal.hitHistory' }))
  expect(await screen.findByText('appAnnotation.viewModal.noHitHistory')).toBeVisible()
  expect(api.history).toHaveBeenCalledExactlyOnceWith({
    params: { app_id: 'app-id', annotation_id: 'a' },
    query: { page: 1, limit: 10 },
  })
  await user.click(screen.getByRole('tab', { name: 'appAnnotation.viewModal.annotatedResponse' }))
  expect(textbox).toHaveValue('Unsaved answer')
})

it('reports history failures and retries without presenting them as an empty history', async () => {
  api.history.mockRejectedValueOnce(new Error('Offline'))
  const { user } = setup()
  await user.click(screen.getByRole('button', { name: 'Question a' }))
  await user.click(screen.getByRole('tab', { name: 'appAnnotation.viewModal.hitHistory' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('common.api.actionFailed')
  expect(screen.queryByText('appAnnotation.viewModal.noHitHistory')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
  expect(await screen.findByText('appAnnotation.viewModal.noHitHistory')).toBeVisible()
})

it('does not show a previous annotation response when its request completes late', async () => {
  const pending =
    createDeferred<
      Awaited<
        ReturnType<typeof consoleClient.apps.byAppId.annotations.byAnnotationId.hitHistories.get>
      >
    >()
  api.history.mockReturnValueOnce(pending.promise)
  const { user } = setup()
  await user.click(screen.getByRole('button', { name: 'Question a' }))
  await user.click(screen.getByRole('tab', { name: 'appAnnotation.viewModal.hitHistory' }))
  await waitFor(() => expect(api.history).toHaveBeenCalledOnce())
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: 'Question b' }))
  await user.click(screen.getByRole('tab', { name: 'appAnnotation.viewModal.hitHistory' }))
  expect(await screen.findByText('appAnnotation.viewModal.noHitHistory')).toBeVisible()
  pending.resolve({
    ...emptyHistory,
    total: 1,
    data: [{ id: 'old', question: 'Old hit', score: 0 }],
  })
  await waitFor(() => expect(api.history).toHaveBeenCalledTimes(2))
  expect(screen.queryByText('Old hit')).not.toBeInTheDocument()
})

it('renders zero scores and loads the requested history page without retaining the previous rows', async () => {
  api.history.mockImplementation(async ({ query }) => ({
    ...emptyHistory,
    page: query?.page ?? 1,
    total: 11,
    has_more: query?.page === 1,
    data:
      query?.page === 2
        ? [{ id: 'last-hit', question: 'Last hit', score: null }]
        : Array.from({ length: 10 }, (_, index) => ({
            id: `hit-${index}`,
            question: `Hit ${index}`,
            match: 'Matched question',
            response: 'Annotated response',
            source: 'web_app',
            score: index / 10,
            created_at: 1710000000,
          })),
  }))
  const { user } = setup()
  await user.click(screen.getByRole('button', { name: 'Question a' }))
  await user.click(screen.getByRole('tab', { name: 'appAnnotation.viewModal.hitHistory' }))
  const firstHit = await screen.findByRole('row', { name: /^Hit 0 / })
  expect(within(firstHit).getByRole('cell', { name: '0.00' })).toBeVisible()
  expect(within(firstHit).getByRole('cell', { name: 'Annotated response' })).toBeVisible()
  expect(within(firstHit).getByRole('cell', { name: 'Created time' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'common.pagination.next' }))
  const lastHit = await screen.findByRole('row', { name: /^Last hit / })
  expect(within(lastHit).getAllByRole('cell', { name: '-' })).toHaveLength(2)
  expect(screen.queryByRole('row', { name: /^Hit 0 / })).not.toBeInTheDocument()
  expect(api.history).toHaveBeenLastCalledWith({
    params: { app_id: 'app-id', annotation_id: 'a' },
    query: { page: 2, limit: 10 },
  })
})
