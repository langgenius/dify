import type { consoleClient } from '@/service/console'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { renderWithConsoleQuery, seedFeatures } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { List } from '../../list'
import EditAnnotationDialog from '../index'

const api = vi.hoisted(() => ({
  edit: vi.fn<typeof consoleClient.apps.byAppId.annotations.byAnnotationId.post>(),
  remove: vi.fn<typeof consoleClient.apps.byAppId.annotations.byAnnotationId.delete>(),
}))
vi.mock('@/hooks/use-timestamp', () => ({ default: () => ({ formatTime: () => 'Created time' }) }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.annotations.byAnnotationId.post': (input) => api.edit(input),
      'apps.byAppId.annotations.byAnnotationId.delete': (input) => api.remove(input),
    }),
  }
})

beforeEach(() => {
  api.edit.mockResolvedValue(undefined)
  api.remove.mockResolvedValue(undefined)
})

async function setup(source: 'chat' | 'list', onlyEditResponse = false) {
  const onEdited = vi.fn()
  const onRemoved = vi.fn()
  const view = renderWithConsoleQuery(
    source === 'chat' ? (
      <div>
        <button>Copy answer</button>
        <EditAnnotationDialog
          appId="app-id"
          annotationId="annotation-id"
          question="Original question"
          answer="Original answer"
          onEdited={onEdited}
          onRemoved={onRemoved}
          onlyEditResponse={onlyEditResponse}
        />
      </div>
    ) : (
      <List
        appId="app-id"
        list={[
          {
            id: 'annotation-id',
            question: 'Original question',
            answer: 'Original answer',
            created_at: 1700000000,
            hit_count: 0,
          },
        ]}
        onEdited={onEdited}
        onRemoved={onRemoved}
        selectedIds={[]}
        onSelectedIdsChange={vi.fn()}
        onBatchDelete={vi.fn()}
      />
    ),
  )
  const user = userEvent.setup()
  const trigger = screen.getByRole('button', { name: 'appDebug.feature.annotation.edit' })
  await user.click(trigger)
  const dialog = screen.getByRole('dialog')
  return { ...view, user, dialog, trigger, onEdited, onRemoved }
}

async function editField(
  user: ReturnType<typeof userEvent.setup>,
  name: 'queryName' | 'answerName',
  value: string,
) {
  const section = screen.getByRole('region', { name: `appAnnotation.editModal.${name}` })
  await user.click(within(section).getByRole('button', { name: 'common.operation.edit' }))
  const input = within(section).getByRole('textbox')
  await user.clear(input)
  if (value) await user.type(input, value)
  return {
    input,
    section,
    save: within(section).getByRole('button', { name: 'common.operation.save' }),
  }
}

describe.each(['chat', 'list'] as const)('%s annotation editor', (source) => {
  it('retains failed drafts, blocks dismissal and duplicate saves while pending, and retries', async () => {
    const pending = createDeferred<undefined>()
    api.edit.mockReturnValueOnce(pending.promise)
    const { user, dialog, onEdited } = await setup(source)
    const { input, save } = await editField(user, 'answerName', 'Corrected answer')
    await user.click(save)
    expect(input).toHaveAttribute('readonly')
    expect(within(dialog).getByRole('button', { name: 'common.operation.close' })).toBeDisabled()
    await user.keyboard('{Escape}')
    await user.click(save)
    expect(api.edit).toHaveBeenCalledTimes(1)
    expect(dialog).toBeInTheDocument()
    pending.reject(new Error('Offline'))
    expect(await screen.findByRole('alert')).toHaveTextContent('common.api.actionFailed')
    expect(input).toHaveValue('Corrected answer')
    expect(onEdited).not.toHaveBeenCalled()
    await user.click(save)
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
    expect(onEdited).toHaveBeenCalledOnce()
    expect(api.edit).toHaveBeenLastCalledWith({
      params: { app_id: 'app-id', annotation_id: 'annotation-id' },
      body: { question: 'Original question', answer: 'Corrected answer' },
    })
  })

  it('uses the last successful values when editing the other field and restoring an edit', async () => {
    const { user } = await setup(source)
    const question = await editField(user, 'queryName', 'Saved question')
    await user.click(question.save)
    await waitFor(() =>
      expect(within(question.section).queryByRole('textbox')).not.toBeInTheDocument(),
    )
    const answer = await editField(user, 'answerName', 'Saved answer')
    await user.click(answer.save)
    await waitFor(() =>
      expect(within(answer.section).queryByRole('textbox')).not.toBeInTheDocument(),
    )
    expect(api.edit).toHaveBeenLastCalledWith({
      params: { app_id: 'app-id', annotation_id: 'annotation-id' },
      body: { question: 'Saved question', answer: 'Saved answer' },
    })
    await user.click(
      within(question.section).getByRole('button', { name: 'common.operation.delete' }),
    )
    await waitFor(() =>
      expect(within(question.section).queryByText('Saved question')).not.toBeInTheDocument(),
    )
    expect(api.edit).toHaveBeenLastCalledWith({
      params: { app_id: 'app-id', annotation_id: 'annotation-id' },
      body: { question: 'Original question', answer: 'Saved answer' },
    })
  })

  it('validates empty edits, cancels drafts, and starts a clean session after closing', async () => {
    const { user, trigger, dialog } = await setup(source)
    const { section, save } = await editField(user, 'answerName', '')
    await user.click(save)
    expect(
      await within(section).findByText('appAnnotation.errorMessage.answerRequired'),
    ).toBeVisible()
    expect(api.edit).not.toHaveBeenCalled()
    await user.click(within(section).getByRole('button', { name: 'common.operation.cancel' }))
    expect(within(section).getByRole('button', { name: 'common.operation.edit' })).toHaveFocus()
    await editField(user, 'answerName', 'Discarded draft')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(trigger)
    const reopened = screen.getByRole('region', { name: 'appAnnotation.editModal.answerName' })
    await user.click(within(reopened).getByRole('button', { name: 'common.operation.edit' }))
    expect(within(reopened).getByRole('textbox')).toHaveValue('Original answer')
  })

  it('waits for deletion, keeps both dialogs on failure, and notifies only after success', async () => {
    const pending = createDeferred<void>()
    api.remove.mockReturnValueOnce(pending.promise)
    const { user, onRemoved } = await setup(source)
    await user.click(
      screen.getByRole('button', { name: 'appAnnotation.editModal.removeThisCache' }),
    )
    const confirmation = screen.getByRole('alertdialog')
    const confirm = within(confirmation).getByRole('button', { name: 'common.operation.confirm' })
    await user.click(confirm)
    await user.keyboard('{Escape}')
    await user.click(confirm)
    expect(api.remove).toHaveBeenCalledOnce()
    expect(onRemoved).not.toHaveBeenCalled()
    pending.reject(new Error('Offline'))
    expect(await within(confirmation).findByRole('alert')).toBeVisible()
    expect(confirmation).toBeInTheDocument()
    await user.click(confirm)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onRemoved).toHaveBeenCalledOnce()
    expect(api.remove).toHaveBeenLastCalledWith({
      params: { app_id: 'app-id', annotation_id: 'annotation-id' },
    })
  })
})

it('keeps the question read-only for a response-only editor', async () => {
  await setup('chat', true)
  expect(
    within(screen.getByRole('region', { name: 'appAnnotation.editModal.queryName' })).queryByRole(
      'button',
    ),
  ).not.toBeInTheDocument()
  expect(
    within(screen.getByRole('region', { name: 'appAnnotation.editModal.answerName' })).getByRole(
      'button',
      { name: 'common.operation.edit' },
    ),
  ).toBeVisible()
})

it('refreshes annotation queries after edits and refreshes quota only when deletion changes the count', async () => {
  const { user, queryClient } = await setup('chat')
  const featuresKey = consoleQuery.features.get.key()
  const countKey = consoleQuery.apps.byAppId.annotations.count.get.queryOptions({
    input: { params: { app_id: 'app-id' } },
  }).queryKey
  seedFeatures(queryClient, { annotation_quota_limit: { size: 1, limit: 10 } })
  queryClient.setQueryData(countKey, { count: 1 })
  const answer = await editField(user, 'answerName', 'Changed answer')
  await user.click(answer.save)
  await waitFor(() => expect(within(answer.section).queryByRole('textbox')).not.toBeInTheDocument())
  expect(queryClient.getQueryState(countKey)?.isInvalidated).toBe(true)
  expect(queryClient.getQueriesData({ queryKey: featuresKey })).not.toHaveLength(0)
  expect(
    queryClient
      .getQueryCache()
      .findAll({ queryKey: featuresKey })
      .some((query) => query.state.isInvalidated),
  ).toBe(false)
  await user.click(screen.getByRole('button', { name: 'appAnnotation.editModal.removeThisCache' }))
  await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(
    queryClient
      .getQueryCache()
      .findAll({ queryKey: featuresKey })
      .every((query) => query.state.isInvalidated),
  ).toBe(true)
})
