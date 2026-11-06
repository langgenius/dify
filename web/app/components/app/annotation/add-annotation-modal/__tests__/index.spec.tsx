import type { consoleClient } from '@/service/console'
import { zGetFeaturesResponse } from '@dify/contracts/api/console/features/zod.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery, seedFeatures } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import AddAnnotationDialog from '../index'

const api = vi.hoisted(() => ({
  add: vi.fn<typeof consoleClient.apps.byAppId.annotations.post>(),
  features: vi.fn<typeof consoleClient.features.get>(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.annotations.post': (input) => api.add(input),
      'features.get': () => api.features(),
    }),
  }
})

vi.mock('@/app/components/billing/annotation-full', () => ({
  default: () => <p>Annotation quota full</p>,
}))

const question = () => screen.getByRole('textbox', { name: 'appAnnotation.addModal.queryName' })
const answer = () => screen.getByRole('textbox', { name: 'appAnnotation.addModal.answerName' })
const submit = () => screen.getByRole('button', { name: 'common.operation.add' })
const next = () => screen.getByRole('checkbox', { name: 'appAnnotation.addModal.createNext' })
const trigger = () =>
  screen.getByRole('button', { name: 'appAnnotation.table.header.addAnnotation' })

async function setup(quota = { size: 0, limit: 10 }, cloud = true) {
  const user = userEvent.setup()
  const onAdded = vi.fn()
  const view = renderWithConsoleQuery(<AddAnnotationDialog appId="app-id" onAdded={onAdded} />, {
    systemFeatures: { deployment_edition: cloud ? 'CLOUD' : 'COMMUNITY' },
    features: { annotation_quota_limit: quota },
  })
  const features = seedFeatures(view.queryClient, { annotation_quota_limit: quota })
  api.features.mockResolvedValue(features)
  await user.click(trigger())
  return { user, onAdded, features }
}

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(question(), 'Question value')
  await user.type(answer(), 'Answer value')
}

beforeEach(() => {
  vi.resetAllMocks()
  api.add.mockResolvedValue({ id: 'annotation-id' })
})

it('validates required fields inline before sending a request', async () => {
  const { user } = await setup()
  await user.click(submit())
  expect(api.add).not.toHaveBeenCalled()
  expect(await screen.findByText('appAnnotation.errorMessage.queryRequired')).toBeVisible()
  expect(screen.getByText('appAnnotation.errorMessage.answerRequired')).toBeVisible()
  expect(question()).toHaveAttribute('aria-invalid', 'true')
  await user.type(question(), 'Question')
  await user.click(submit())
  expect(api.add).not.toHaveBeenCalled()
  expect(screen.getByText('appAnnotation.errorMessage.answerRequired')).toBeVisible()
})

it('creates an annotation, refreshes its owner, and closes on success', async () => {
  const { user, onAdded } = await setup()
  await fill(user)
  await user.click(submit())
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(api.add).toHaveBeenCalledExactlyOnceWith({
    params: { app_id: 'app-id' },
    body: { question: 'Question value', answer: 'Answer value' },
  })
  expect(onAdded).toHaveBeenCalledOnce()
  expect(api.features).toHaveBeenCalled()
})

it.each([false, true])(
  'preserves a failed draft for retry with create next %s',
  async (createNext) => {
    api.add.mockRejectedValueOnce(new Error('Save failed'))
    const { user, onAdded } = await setup()
    await fill(user)
    if (createNext) await user.click(next())
    await user.click(submit())
    await waitFor(() => expect(submit()).not.toHaveAttribute('aria-disabled', 'true'))
    expect(await screen.findByRole('alert')).toHaveTextContent('common.api.actionFailed')
    expect(question()).toHaveValue('Question value')
    expect(answer()).toHaveValue('Answer value')
    expect(onAdded).not.toHaveBeenCalled()
    await user.click(submit())
    await waitFor(() => expect(onAdded).toHaveBeenCalledOnce())
    expect(api.add).toHaveBeenCalledTimes(2)
    if (createNext) {
      await waitFor(() => expect(question()).toHaveValue(''))
      expect(answer()).toHaveValue('')
      expect(next()).toBeChecked()
    } else {
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    }
  },
)

it('keeps the in-flight draft stable and prevents duplicate submission or dismissal', async () => {
  const request =
    createDeferred<Awaited<ReturnType<typeof consoleClient.apps.byAppId.annotations.post>>>()
  api.add.mockReturnValue(request.promise)
  const { user } = await setup()
  await fill(user)
  await user.click(submit())
  await waitFor(() => expect(submit()).toHaveAttribute('aria-disabled', 'true'))
  expect(question()).toHaveAttribute('readonly')
  expect(answer()).toHaveAttribute('readonly')
  expect(next()).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeDisabled()
  await user.keyboard('{Escape}')
  await user.click(submit())
  expect(screen.getByRole('dialog')).toBeVisible()
  expect(api.add).toHaveBeenCalledOnce()
  request.resolve({ id: 'annotation-id' })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('starts a fresh form after cancel and reopen', async () => {
  const { user } = await setup()
  await fill(user)
  await user.click(next())
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(trigger())
  expect(question()).toHaveValue('')
  expect(answer()).toHaveValue('')
  expect(next()).not.toBeChecked()
})

it('rechecks quota after creation before allowing the next annotation', async () => {
  const { user, features } = await setup({ size: 9, limit: 10 })
  await fill(user)
  await user.click(next())
  api.features.mockResolvedValue({ ...features, annotation_quota_limit: { size: 10, limit: 10 } })
  await user.click(submit())
  expect(await screen.findByText('Annotation quota full')).toBeVisible()
  expect(submit()).toBeDisabled()
  expect(api.add).toHaveBeenCalledOnce()
})

it.each([
  { quota: { size: 10, limit: 10 }, cloud: true, disabled: true },
  { quota: { size: 10, limit: 0 }, cloud: true, disabled: false },
  { quota: { size: 10, limit: 10 }, cloud: false, disabled: false },
])('honors quota $quota.limit with cloud=$cloud', async ({ quota, cloud, disabled }) => {
  await setup(quota, cloud)
  if (disabled) expect(submit()).toBeDisabled()
  else expect(submit()).toBeEnabled()
})

it('blocks saving until quota loads and lets a failed quota request retry', async () => {
  const request = createDeferred<Awaited<ReturnType<typeof consoleClient.features.get>>>()
  api.features.mockReturnValueOnce(request.promise)
  const user = userEvent.setup()
  renderWithConsoleQuery(<AddAnnotationDialog appId="app-id" onAdded={vi.fn()} />, {
    systemFeatures: { deployment_edition: 'CLOUD' },
  })
  await user.click(trigger())
  expect(submit()).toBeDisabled()
  request.reject(new Error('Quota unavailable'))
  const retry = await screen.findByRole('button', { name: 'common.operation.retry' })
  expect(screen.getByRole('alert')).toHaveTextContent('common.api.actionFailed')
  expect(submit()).toBeDisabled()
  api.features.mockResolvedValue(
    zGetFeaturesResponse.parse({ annotation_quota_limit: { size: 0, limit: 10 } }),
  )
  await user.click(retry)
  await waitFor(() => expect(submit()).toBeEnabled())
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(api.add).not.toHaveBeenCalled()
})
