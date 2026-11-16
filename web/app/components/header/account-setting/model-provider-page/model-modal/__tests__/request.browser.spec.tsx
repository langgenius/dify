import { onlineManager } from '@tanstack/react-query'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import {
  createCredentialProvider,
  credential,
  customModel,
} from '../../__tests__/credential-test-env'
import { ConfigurationMethodEnum, ModelModalModeEnum } from '../../declarations'
import { ModelCredentialDialog } from '../dialog'
import { modelCredentialDialog } from '../handle'

const api = vi.hoisted(() => ({ save: vi.fn(), activate: vi.fn(), remove: vi.fn() }))
// boundary: control completion of the generated credential operations while retaining the real form and query observers.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.modelProviders.byProvider.credentials.post': api.save,
      'workspaces.current.modelProviders.byProvider.models.credentials.switch.post': api.activate,
      'workspaces.current.modelProviders.byProvider.credentials.delete': api.remove,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.byProvider.credentials.get': () => ({
        credentials: { api_key: 'masked' },
      }),
      'workspaces.current.modelProviders.byProvider.models.credentials.get': () => ({
        credentials: {},
        available_credentials: [credential],
      }),
    }),
  }
})

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
  vi.resetAllMocks()
})

type Payload = Parameters<typeof modelCredentialDialog.openWithPayload>[0]
async function setup(options: Partial<Payload> = {}) {
  const payload = {
    provider: createCredentialProvider(),
    configurateMethod: ConfigurationMethodEnum.predefinedModel,
    ...options,
  }
  const { queryClient, wrapper: Wrapper } = createConsoleQueryWrapper({
    workspacePermissionKeys: ['credential.use', 'credential.create', 'credential.manage'],
  })
  seedModelProviderQueries(queryClient)
  const screen = await render(
    <Wrapper>
      <button type="button" onClick={() => modelCredentialDialog.openWithPayload(payload)}>
        Open credentials
      </button>
      <ModelCredentialDialog />
    </Wrapper>,
  )
  await screen.getByRole('button', { name: 'Open credentials' }).click()
  return screen
}

it('keeps a pending save open on Escape and retains the entered draft for retry', async () => {
  const failed = createDeferred()
  api.save.mockReturnValueOnce(failed.promise).mockResolvedValueOnce({ result: 'success' })
  const onSave = vi.fn()
  const screen = await setup({ onSave })
  const key = screen.getByLabelText(/API key/)
  const save = screen.getByRole('button', { name: 'common.operation.save' })
  onlineManager.setOnline(false)
  onTestFinished(() => onlineManager.setOnline(true))
  await key.fill('draft-key')
  await userEvent.keyboard('{Enter}')
  await expect.element(save).toBeDisabled()
  await expect
    .element(screen.getByRole('button', { name: 'common.operation.cancel' }))
    .toBeDisabled()
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('dialog')).toBeVisible()
  failed.reject(new Error('Save failed'))
  await expect.element(key).toBeEnabled()
  await expect.element(key).toHaveValue('draft-key')
  expect(onSave).not.toHaveBeenCalled()
  onlineManager.setOnline(true)
  await save.click()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  expect(onSave).toHaveBeenCalledTimes(1)
})

it('keeps the replacement credential draft when an earlier request succeeds', async () => {
  const pending = createDeferred<{ result: string }>()
  api.save.mockReturnValueOnce(pending.promise)
  const onSave = vi.fn()
  const screen = await setup({ onSave })
  const key = screen.getByLabelText(/API key/)
  await key.fill('first-key')
  await screen.getByRole('button', { name: 'common.operation.save' }).click()
  await expect.element(key).toBeDisabled()
  modelCredentialDialog.close()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'Open credentials' }).click()
  await key.fill('second-key')
  pending.resolve({ result: 'success' })
  await expect
    .poll(() => onSave.mock.calls)
    .toEqual([[undefined, expect.objectContaining({ api_key: 'first-key' })]])
  await expect.element(key).toHaveValue('second-key')
  await expect.element(screen.getByRole('dialog')).toBeVisible()
})

it('leaves the new dialog host open when a save from the previous host completes', async () => {
  const pending = createDeferred<{ result: string }>()
  api.save.mockReturnValueOnce(pending.promise)
  const onSave = vi.fn()
  const previous = await setup({ onSave })
  await previous.getByLabelText(/API key/).fill('first-key')
  await previous.getByRole('button', { name: 'common.operation.save' }).click()
  await expect.element(previous.getByLabelText(/API key/)).toBeDisabled()
  await previous.unmount()

  const current = await setup()
  const key = current.getByLabelText(/API key/)
  await key.fill('second-key')
  pending.resolve({ result: 'success' })
  await expect.poll(() => onSave.mock.calls.length).toBe(1)
  await expect.element(key).toHaveValue('second-key')
})

it('keeps an existing credential selected when activation fails and closes after a successful retry', async () => {
  api.activate.mockRejectedValueOnce(new Error('Activation failed')).mockResolvedValueOnce({})
  const screen = await setup({
    isModelCredential: true,
    model: customModel,
    mode: ModelModalModeEnum.addCustomModelToModelList,
  })
  await screen.getByRole('button', { name: /selectModelCredential/ }).click()
  await screen.getByRole('button', { name: 'Key 1' }).click()
  const add = screen.getByRole('button', { name: 'common.operation.add' })
  await add.click()
  await expect.poll(() => api.activate.mock.calls.length).toBe(1)
  await expect.element(screen.getByRole('button', { name: 'Key 1' })).toBeVisible()
  await add.click()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  expect(api.activate).toHaveBeenCalledTimes(2)
})

it('keeps deletion confirmation pending, then allows retry after a failure', async () => {
  const failed = createDeferred()
  api.remove.mockReturnValueOnce(failed.promise).mockResolvedValueOnce({})
  const screen = await setup({ credential })
  await screen.getByRole('button', { name: 'common.operation.remove' }).click()
  const confirm = screen.getByRole('button', { name: 'common.operation.confirm' })
  await confirm.click()
  await expect.element(confirm).toBeDisabled()
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('alertdialog')).toBeVisible()
  failed.reject(new Error('Delete failed'))
  await expect.element(confirm).toBeEnabled()
  await confirm.click()
  await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  expect(api.remove).toHaveBeenCalledTimes(2)
})
