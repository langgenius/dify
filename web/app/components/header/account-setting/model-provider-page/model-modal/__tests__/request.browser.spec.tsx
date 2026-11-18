import { onlineManager } from '@tanstack/react-query'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AppToaster } from '@/app/notifications/app-toaster'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { apiError, installFakeApi, networkError } from '@/test/fake-api'
import {
  createCredentialProvider,
  credential,
  customModel,
} from '../../__tests__/credential-test-env'
import { ConfigurationMethodEnum, ModelModalModeEnum } from '../../declarations'
import { ModelCredentialDialog } from '../dialog'
import { modelCredentialDialog } from '../handle'

const api = { save: vi.fn(), activate: vi.fn(), remove: vi.fn() }

beforeEach(() => {
  vi.resetAllMocks()
  onTestFinished(
    installFakeApi({
      console: {
        workspaces: {
          current: {
            modelProviders: {
              byProvider: {
                credentials: {
                  get: () => ({ credentials: { api_key: 'masked' } }),
                  post: (input) => api.save(input),
                  delete: async (input) => {
                    await api.remove(input)
                  },
                },
                models: {
                  credentials: {
                    get: () => ({
                      credentials: {},
                      available_credentials: [credential],
                      load_balancing: { enabled: false, configs: [] },
                    }),
                    post: (input) => api.save(input),
                    switch: { post: (input) => api.activate(input) },
                  },
                },
              },
            },
          },
        },
      },
    }),
  )
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
      <AppToaster />
    </Wrapper>,
  )
  await screen.getByRole('button', { name: 'Open credentials' }).click()
  return screen
}

it.each([
  // An offline request has no response, so only the dialog reports the failure.
  { failure: 'a network failure', error: networkError, toast: 'common.api.actionFailed' },
  // An HTTP error with a backend message is reported by the shared error toast instead.
  {
    failure: 'a 502 response',
    error: () => apiError('BAD_GATEWAY', 502, 'Bad gateway'),
    toast: 'Bad gateway',
  },
])('retains the draft and allows retry after $failure', async ({ error, toast }) => {
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
  await expect.element(screen.getByRole('dialog', { name: /modelProvider/ })).toBeVisible()
  await expect.poll(() => api.save).toHaveBeenCalledOnce()
  failed.reject(error())
  await expect.element(screen.getByText(toast, { exact: true })).toBeVisible()
  await expect.element(key).toBeEnabled()
  await expect.element(key).toHaveValue('draft-key')
  expect(onSave).not.toHaveBeenCalled()
  onlineManager.setOnline(true)
  await save.click()
  await expect
    .element(screen.getByRole('dialog', { name: /modelProvider/ }))
    .not.toBeInTheDocument()
  expect(onSave).toHaveBeenCalledTimes(1)
})

it('submits the custom model and key together with Enter and focuses the first missing field', async () => {
  api.save.mockResolvedValue({ result: 'success' })
  const screen = await setup({
    mode: ModelModalModeEnum.configCustomModel,
    isModelCredential: true,
    configurateMethod: ConfigurationMethodEnum.customizableModel,
  })
  const name = screen.getByRole('textbox', { name: /Model/ })
  await screen.getByLabelText(/API key/).fill('secret')
  await userEvent.keyboard('{Enter}')
  await expect.element(name).toHaveFocus()
  expect(api.save).not.toHaveBeenCalled()
  await screen.getByRole('combobox', { name: 'Model Type' }).click()
  await screen.getByRole('option', { name: 'LLM' }).click()
  await name.click()
  await name.fill('custom-model')
  await expect.element(name).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('dialog', { name: /modelProvider/ }))
    .not.toBeInTheDocument()
  expect(api.save).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      params: { provider: 'openai' },
      body: expect.objectContaining({
        model: 'custom-model',
        model_type: 'llm',
        credentials: expect.objectContaining({ api_key: 'secret' }),
      }),
    }),
  )
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
  await expect
    .element(screen.getByRole('dialog', { name: /modelProvider/ }))
    .not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'Open credentials' }).click()
  await key.fill('second-key')
  pending.resolve({ result: 'success' })
  await expect
    .poll(() => onSave.mock.calls)
    .toEqual([[undefined, expect.objectContaining({ api_key: 'first-key' })]])
  await expect.element(key).toHaveValue('second-key')
  await expect.element(screen.getByRole('dialog', { name: /modelProvider/ })).toBeVisible()
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
  api.activate
    .mockRejectedValueOnce(apiError('SERVICE_UNAVAILABLE', 503, 'Activation failed'))
    .mockResolvedValueOnce({ result: 'success' })
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
  await expect
    .element(screen.getByRole('dialog', { name: /modelProvider/ }))
    .not.toBeInTheDocument()
  expect(api.activate).toHaveBeenCalledTimes(2)
})

it('keeps deletion confirmation pending, then allows retry after a failure', async () => {
  const failed = createDeferred()
  api.remove.mockReturnValueOnce(failed.promise).mockResolvedValueOnce(undefined)
  const screen = await setup({ credential })
  await screen.getByRole('button', { name: 'common.operation.remove' }).click()
  const confirm = screen.getByRole('button', { name: 'common.operation.confirm' })
  await confirm.click()
  await expect.element(confirm).toBeDisabled()
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('alertdialog')).toBeVisible()
  await expect.poll(() => api.remove).toHaveBeenCalledOnce()
  failed.reject(apiError('SERVICE_UNAVAILABLE', 503, 'Delete failed'))
  await expect.element(confirm).toBeEnabled()
  await confirm.click()
  await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('dialog', { name: /modelProvider/ }))
    .not.toBeInTheDocument()
  expect(api.remove).toHaveBeenCalledTimes(2)
})
