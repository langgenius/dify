import { onlineManager } from '@tanstack/react-query'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AppToaster } from '@/app/notifications/app-toaster'
import { createErrorToastCaches } from '@/app/query-error-toast'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { apiError, networkError, setupFakeApi } from '@/test/fake-api'
import {
  createCredentialProvider,
  credential,
  customModel,
} from '../../__tests__/credential-test-env'
import { ConfigurationMethodEnum, ModelModalModeEnum } from '../../declarations'
import { ModelCredentialDialog } from '../dialog'
import { modelCredentialDialog } from '../handle'

const fake = setupFakeApi(() => ({
  console: {
    workspaces: {
      current: {
        modelProviders: {
          byProvider: {
            credentials: {
              get: () => ({ credentials: { api_key: 'masked' } }),
              post: () => ({ result: 'success' }),
              delete: async () => {},
            },
            models: {
              credentials: {
                get: () => ({
                  credentials: {},
                  available_credentials: [credential],
                  load_balancing: { enabled: false, configs: [] },
                }),
                post: () => ({ result: 'success' }),
                switch: { post: () => ({ result: 'success' }) },
              },
            },
          },
        },
      },
    },
  },
}))

type Payload = Parameters<typeof modelCredentialDialog.openWithPayload>[0]
async function setup(options: Partial<Payload> = {}) {
  const payload = {
    provider: createCredentialProvider(),
    configurateMethod: ConfigurationMethodEnum.predefinedModel,
    ...options,
  }
  const { queryClient, wrapper: Wrapper } = createConsoleQueryWrapper({
    // Failed saves are reported by the app's mutation cache.
    queryClient: createConsoleQueryClient({ caches: createErrorToastCaches() }),
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
  // An HTTP error with a backend message is reported by the mutation cache's toast instead.
  {
    failure: 'a 502 response',
    error: () => apiError({ status: 502, code: 'BAD_GATEWAY', message: 'Bad gateway' }),
    toast: 'Bad gateway',
  },
  // Without a backend message only the mutation cache's generic server text is shown; the dialog
  // adds none.
  {
    failure: 'a 502 response without a message',
    error: () => apiError({ status: 502, code: 'BAD_GATEWAY', message: ' ' }),
    toast: 'requestErrors.generic.server',
  },
])('retains the draft and allows retry after $failure', async ({ error, toast }) => {
  const failed = createDeferred<{ result: string }>()
  fake.console.workspaces.current.modelProviders.byProvider.credentials.post
    .mockReturnValueOnce(failed.promise)
    .mockResolvedValueOnce({ result: 'success' })
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
  await expect
    .poll(() => fake.console.workspaces.current.modelProviders.byProvider.credentials.post)
    .toHaveBeenCalledOnce()
  failed.reject(error())
  await expect.element(screen.getByText(toast, { exact: true })).toBeVisible()
  // The dialog's own toast is only for requests that never got a response.
  if (toast !== 'common.api.actionFailed')
    expect(screen.getByText('common.api.actionFailed', { exact: true }).query()).toBeNull()
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
  const screen = await setup({
    mode: ModelModalModeEnum.configCustomModel,
    isModelCredential: true,
    configurateMethod: ConfigurationMethodEnum.customizableModel,
  })
  const name = screen.getByRole('textbox', { name: /Model/ })
  await screen.getByLabelText(/API key/).fill('secret')
  await userEvent.keyboard('{Enter}')
  await expect.element(name).toHaveFocus()
  expect(
    fake.console.workspaces.current.modelProviders.byProvider.models.credentials.post,
  ).not.toHaveBeenCalled()
  await screen.getByRole('combobox', { name: 'Model Type' }).click()
  await screen.getByRole('option', { name: 'LLM' }).click()
  await name.click()
  await name.fill('custom-model')
  await expect.element(name).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('dialog', { name: /modelProvider/ }))
    .not.toBeInTheDocument()
  expect(
    fake.console.workspaces.current.modelProviders.byProvider.models.credentials.post,
  ).toHaveBeenCalledExactlyOnceWith(
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
  fake.console.workspaces.current.modelProviders.byProvider.credentials.post.mockReturnValueOnce(
    pending.promise,
  )
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
  fake.console.workspaces.current.modelProviders.byProvider.credentials.post.mockReturnValueOnce(
    pending.promise,
  )
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
  fake.console.workspaces.current.modelProviders.byProvider.models.credentials.switch.post
    .mockRejectedValueOnce(
      apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Activation failed' }),
    )
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
  await expect
    .poll(
      () =>
        fake.console.workspaces.current.modelProviders.byProvider.models.credentials.switch.post
          .mock.calls.length,
    )
    .toBe(1)
  await expect.element(screen.getByRole('button', { name: 'Key 1' })).toBeVisible()
  await add.click()
  await expect
    .element(screen.getByRole('dialog', { name: /modelProvider/ }))
    .not.toBeInTheDocument()
  expect(
    fake.console.workspaces.current.modelProviders.byProvider.models.credentials.switch.post,
  ).toHaveBeenCalledTimes(2)
})

it('keeps deletion confirmation pending, then allows retry after a failure', async () => {
  const failed = createDeferred()
  fake.console.workspaces.current.modelProviders.byProvider.credentials.delete
    .mockReturnValueOnce(failed.promise)
    .mockResolvedValueOnce(undefined)
  const screen = await setup({ credential })
  await screen.getByRole('button', { name: 'common.operation.remove' }).click()
  const confirm = screen.getByRole('button', { name: 'common.operation.confirm' })
  await confirm.click()
  await expect.element(confirm).toBeDisabled()
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('alertdialog')).toBeVisible()
  await expect
    .poll(() => fake.console.workspaces.current.modelProviders.byProvider.credentials.delete)
    .toHaveBeenCalledOnce()
  failed.reject(apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Delete failed' }))
  await expect.element(confirm).toBeEnabled()
  await confirm.click()
  await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('dialog', { name: /modelProvider/ }))
    .not.toBeInTheDocument()
  expect(
    fake.console.workspaces.current.modelProviders.byProvider.credentials.delete,
  ).toHaveBeenCalledTimes(2)
})
