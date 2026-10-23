import type {
  Annotation as AnnotationData,
  AnnotationSettingResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { consoleClient } from '@/service/console'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import Annotation from '../index'

const api = vi.hoisted(() => ({
  list: vi.fn<typeof consoleClient.apps.byAppId.annotations.get>(),
  add: vi.fn<typeof consoleClient.apps.byAppId.annotations.post>(),
  remove: vi.fn<typeof consoleClient.apps.byAppId.annotations.byAnnotationId.delete>(),
  batchRemove: vi.fn<typeof consoleClient.apps.byAppId.annotations.delete>(),
  edit: vi.fn<typeof consoleClient.apps.byAppId.annotations.byAnnotationId.post>(),
  config: vi.fn<typeof consoleClient.apps.byAppId.annotationSetting.get>(),
  status: vi.fn<typeof consoleClient.apps.byAppId.annotationReply.byAction.post>(),
  job: vi.fn<typeof consoleClient.apps.byAppId.annotationReply.byAction.status.byJobId.get>(),
  score: vi.fn<typeof consoleClient.apps.byAppId.annotationSettings.byAnnotationSettingId.post>(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.annotations.count.get': () => ({ count: 0 }),
      'apps.byAppId.annotations.byAnnotationId.delete': (input) => api.remove(input),
      'apps.byAppId.annotations.delete': (input) => api.batchRemove(input),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.annotations.get': (input) => api.list(input),
      'apps.byAppId.annotations.export.get': () => ({ data: [] }),
      'apps.byAppId.annotations.post': (input) => api.add(input),
      'apps.byAppId.annotations.delete': (input) => api.batchRemove(input),
      'apps.byAppId.annotations.byAnnotationId.delete': (input) => api.remove(input),
      'apps.byAppId.annotations.byAnnotationId.post': (input) => api.edit(input),
      'apps.byAppId.annotations.byAnnotationId.hitHistories.get': () => ({
        data: [],
        total: 0,
        page: 1,
        limit: 10,
        has_more: false,
      }),
      'apps.byAppId.annotationSetting.get': (input) => api.config(input),
      'apps.byAppId.annotationReply.byAction.post': (input) => api.status(input),
      'apps.byAppId.annotationReply.byAction.status.byJobId.get': (input) => api.job(input),
      'apps.byAppId.annotationSettings.byAnnotationSettingId.post': (input) => api.score(input),
    }),
  }
})

const item: AnnotationData = {
  id: 'annotation-1',
  question: 'Question 1',
  answer: 'Answer 1',
  created_at: 1700000000,
  hit_count: 0,
}
const initialConfig: AnnotationSettingResponse = {
  id: 'config-id',
  enabled: false,
  score_threshold: 0.5,
  embedding_model: {
    embedding_provider_name: 'openai',
    embedding_model_name: 'text-embedding-ada-002',
  },
}
let annotations: AnnotationData[]
let config: AnnotationSettingResponse

function setup(quota = { size: 0, limit: 10 }) {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      models: [
        createCatalogModelFixture({
          model: 'text-embedding-ada-002',
          label: { en_US: 'Ada Embedding' },
          model_type: 'text-embedding',
        }),
      ],
    }),
    createModelCatalogFixture({
      provider: 'cohere',
      models: [
        createCatalogModelFixture({
          model: 'embed-english',
          label: { en_US: 'English Embedding' },
          model_type: 'text-embedding',
        }),
      ],
    }),
  ])
  renderWithConsoleQuery(
    <NuqsTestingAdapter>
      <Annotation appDetail={createAppDetailFixture({ id: 'app-id', mode: 'chat' })} />
      <AppToaster />
    </NuqsTestingAdapter>,
    {
      queryClient,
      systemFeatures: { deployment_edition: 'CLOUD' },
      features: { annotation_quota_limit: quota },
    },
  )
  return userEvent.setup()
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset()
  annotations = []
  config = { ...initialConfig }
  api.list.mockImplementation(async () => ({
    data: [...annotations],
    total: annotations.length,
    has_more: false,
    limit: 10,
    page: 1,
  }))
  api.config.mockImplementation(async () => config)
  api.add.mockImplementation(async ({ body }) => {
    const added = { ...item, question: body.question, answer: body.answer }
    annotations.push(added)
    return added
  })
  api.remove.mockImplementation(async () => {
    annotations = []
    return { result: 'success' }
  })
  api.batchRemove.mockImplementation(async () => {
    annotations = []
    return { result: 'success' }
  })
  api.edit.mockImplementation(async ({ body }) => {
    const edited = { ...item, question: body.question, answer: body.answer }
    annotations = [edited]
    return edited
  })
  api.status.mockImplementation(async ({ params, body }) => {
    config = {
      ...config,
      enabled: params.action === 'enable',
      id: params.action === 'enable' ? 'enabled-config-id' : config.id,
      embedding_model: {
        embedding_model_name: body.embedding_model_name,
        embedding_provider_name: body.embedding_provider_name,
      },
    }
    return { job_id: 'job-1', job_status: 'completed' }
  })
  api.job.mockResolvedValue({ job_id: 'job-1', job_status: 'completed', error_msg: '' })
  api.score.mockImplementation(async ({ body }) => {
    config = { ...config, score_threshold: body.score_threshold }
    return config
  })
})

afterEach(() => toast.dismiss())

it('creates an annotation from the empty page and displays the saved record', async () => {
  const user = setup()
  expect(await screen.findByText('appAnnotation.noData.title')).toBeVisible()
  await user.click(
    await screen.findByRole('button', { name: 'appAnnotation.table.header.addAnnotation' }),
  )
  const dialog = await screen.findByRole('dialog', { name: 'appAnnotation.addModal.title' })
  await user.type(
    within(dialog).getByRole('textbox', { name: 'appAnnotation.addModal.queryName' }),
    'New question',
  )
  await user.type(
    within(dialog).getByRole('textbox', { name: 'appAnnotation.addModal.answerName' }),
    'New answer',
  )
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.add' }))
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
  expect(await screen.findByRole('checkbox', { name: 'New question' })).toBeVisible()
  expect(screen.getByRole('cell', { name: 'New answer' })).toBeVisible()
  expect(screen.queryByText('common.api.actionSuccess')).not.toBeInTheDocument()
  expect(api.add).toHaveBeenCalledExactlyOnceWith({
    params: { app_id: 'app-id' },
    body: { question: 'New question', answer: 'New answer' },
  })
})

it('removes a row after confirmation and refreshes the empty state', async () => {
  annotations = [item]
  const user = setup()
  await user.click(
    await screen.findByRole('button', { name: 'appDebug.feature.annotation.remove' }),
  )
  const dialog = await screen.findByRole('alertdialog')
  expect(api.remove).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(await screen.findByText('appAnnotation.noData.title')).toBeVisible()
  expect(api.remove).toHaveBeenCalledExactlyOnceWith({
    params: { app_id: 'app-id', annotation_id: item.id },
  })
})

it('keeps a failed batch deletion open for retry and clears the selection after success', async () => {
  annotations = [item]
  api.batchRemove.mockRejectedValueOnce(new Error('Delete failed'))
  const user = setup()
  await user.click(await screen.findByRole('checkbox', { name: 'Question 1' }))
  await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'appAnnotation.list.delete.title' })
  expect(api.batchRemove).not.toHaveBeenCalled()
  const confirm = within(dialog).getByRole('button', { name: 'common.operation.delete' })
  await user.click(confirm)
  expect(await screen.findByText('Delete failed')).toBeVisible()
  expect(dialog).toBeVisible()
  await user.click(confirm)
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(await screen.findByText('appAnnotation.noData.title')).toBeVisible()
  expect(screen.queryByText('appAnnotation.batchAction.selected')).not.toBeInTheDocument()
  expect(screen.queryByText('common.api.actionSuccess')).not.toBeInTheDocument()
  expect(api.batchRemove).toHaveBeenCalledTimes(2)
  expect(api.batchRemove).toHaveBeenLastCalledWith({
    params: { app_id: 'app-id' },
    query: { annotation_id: [item.id] },
  })
})

it('saves edits from the detail drawer and shows them when reopened', async () => {
  annotations = [item]
  const user = setup()
  await user.click(await screen.findByRole('button', { name: 'appDebug.feature.annotation.edit' }))
  const dialog = await screen.findByRole('dialog', {
    name: 'appAnnotation.viewModal.annotatedResponse',
  })
  await user.click(within(dialog).getAllByRole('button', { name: 'common.operation.edit' })[0]!)
  await user.type(
    within(dialog).getByRole('textbox', { name: 'appAnnotation.editModal.yourQuery' }),
    'Edited question',
  )
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() =>
    expect(api.edit).toHaveBeenCalledExactlyOnceWith({
      params: { app_id: 'app-id', annotation_id: item.id },
      body: { question: 'Edited question', answer: 'Answer 1' },
    }),
  )
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
  expect(await screen.findByRole('checkbox', { name: 'Edited question' })).toBeVisible()
  expect(screen.queryByText('common.api.actionSuccess')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'appDebug.feature.annotation.edit' }))
  expect(
    within(
      await screen.findByRole('dialog', { name: 'appAnnotation.viewModal.annotatedResponse' }),
    ).getByText('Edited question'),
  ).toBeVisible()
})

it('removes an annotation through its detail drawer and closes it', async () => {
  annotations = [item]
  const user = setup()
  await user.click(await screen.findByRole('button', { name: 'appDebug.feature.annotation.edit' }))
  const dialog = await screen.findByRole('dialog', {
    name: 'appAnnotation.viewModal.annotatedResponse',
  })
  await user.click(
    within(dialog).getByRole('button', {
      name: 'appAnnotation.editModal.removeThisCache',
    }),
  )
  const confirm = await screen.findByRole('alertdialog')
  await user.click(within(confirm).getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
  expect(await screen.findByText('appAnnotation.noData.title')).toBeVisible()
  expect(screen.queryByText('common.api.actionSuccess')).not.toBeInTheDocument()
  expect(api.remove).toHaveBeenCalledExactlyOnceWith({
    params: { app_id: 'app-id', annotation_id: item.id },
  })
})

it('refreshes annotations after the header clear-all action', async () => {
  annotations = [item]
  const user = setup()
  await screen.findByRole('checkbox', { name: 'Question 1' })
  await user.click(await screen.findByRole('button', { name: 'common.operation.more' }))
  await user.click(
    await screen.findByRole('menuitem', { name: 'appAnnotation.table.header.clearAll' }),
  )
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.confirm' }))
  expect(await screen.findByText('appAnnotation.noData.title')).toBeVisible()
  expect(api.batchRemove).toHaveBeenCalledExactlyOnceWith({ params: { app_id: 'app-id' } })
})

it('shows the quota dialog without enabling annotated replies when the plan is full', async () => {
  const user = setup({ size: 10, limit: 10 })
  await user.click(await screen.findByRole('switch'))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('billing.annotatedResponse.fullTipLine1')).toBeVisible()
  expect(api.status).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
  expect(screen.getByRole('switch')).not.toBeChecked()
})

it('disables annotated replies and reloads settings after the job completes', async () => {
  config = { ...initialConfig, enabled: true }
  const user = setup()
  await waitFor(() => expect(screen.getByRole('switch')).toBeChecked())
  await user.click(screen.getByRole('switch'))
  await waitFor(() => expect(screen.getByRole('switch')).not.toBeChecked())
  expect(api.status).toHaveBeenCalledExactlyOnceWith({
    params: { app_id: 'app-id', action: 'disable' },
    body: {
      embedding_provider_name: 'openai',
      embedding_model_name: 'text-embedding-ada-002',
      score_threshold: 0.5,
    },
  })
  expect(api.job).toHaveBeenCalledExactlyOnceWith({
    params: { app_id: 'app-id', action: 'disable', job_id: 'job-1' },
  })
})

it('enables replies with the selected model and saves the score to the returned settings id', async () => {
  const user = setup()
  await user.click(await screen.findByRole('switch'))
  const dialog = await screen.findByRole('dialog', { name: 'appAnnotation.initSetup.title' })
  await user.click(within(dialog).getByRole('button', { name: /Ada Embedding/ }))
  await user.click(await screen.findByRole('button', { name: /English Embedding/ }))
  within(dialog).getByRole('slider').focus()
  await user.keyboard('{ArrowRight}')
  expect(within(dialog).getByRole('slider')).toHaveAttribute('aria-valuenow', '0.51')
  await user.click(
    within(dialog).getByRole('button', { name: 'appAnnotation.initSetup.confirmBtn' }),
  )
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
  expect(screen.getByRole('switch')).toBeChecked()
  expect(api.status).toHaveBeenCalledExactlyOnceWith({
    params: { app_id: 'app-id', action: 'enable' },
    body: {
      embedding_provider_name: 'cohere',
      embedding_model_name: 'embed-english',
      score_threshold: 0.51,
    },
  })
  expect(api.job).toHaveBeenCalledExactlyOnceWith({
    params: { app_id: 'app-id', action: 'enable', job_id: 'job-1' },
  })
  expect(api.score).toHaveBeenCalledExactlyOnceWith({
    params: { app_id: 'app-id', annotation_setting_id: 'enabled-config-id' },
    body: { score_threshold: 0.51 },
  })
})
