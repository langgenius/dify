import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import type { ModerationConfig } from '@/models/debug'
import type { ConsoleClient } from '@/service/console'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import ModerationSettingModal from '../moderation-setting-modal'

const { getExtensions, createExtension } = vi.hoisted(() => ({
  getExtensions: vi.fn<ConsoleClient['apiBasedExtension']['get']>(),
  createExtension: vi.fn<ConsoleClient['apiBasedExtension']['post']>(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { createConsoleQuery } = await import('@/service/console/query-policies')
  const consoleClient = new Proxy(actual.consoleClient, {
    get(target, property, receiver) {
      if (property === 'apiBasedExtension') {
        return {
          get: getExtensions,
          post: createExtension,
          byId: target.apiBasedExtension.byId,
        }
      }
      return Reflect.get(target, property, receiver)
    },
  })
  return { ...actual, consoleClient, consoleQuery: createConsoleQuery(consoleClient) }
})

vi.mock('@/service/use-common', () => ({
  useCodeBasedExtensions: () => ({ data: { data: [] } }),
  useModelProviderDetails: () => ({ data: { data: [] }, isPending: false }),
}))

vi.mock('nuqs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('nuqs')>()),
  useQueryState: () => [null, vi.fn()],
}))

const existingExtension: ApiBasedExtensionResponse = {
  id: 'existing-extension',
  name: 'Existing API',
  api_endpoint: 'https://existing.example.test',
  api_key: 'existing-secret',
}
const newExtension: ApiBasedExtensionResponse = {
  id: 'new-extension',
  name: 'New API',
  api_endpoint: 'https://new.example.test',
  api_key: 'new-secret',
}
const moderation: ModerationConfig = {
  enabled: true,
  type: 'api',
  config: {
    api_based_extension_id: existingExtension.id,
    inputs_config: { enabled: true },
    outputs_config: { enabled: false },
  },
}
const childDialogName = 'common.apiBasedExtension.modal.title'
const outputLabel = 'appDebug.feature.moderation.modal.content.output'

const renderModal = async () => {
  const onSave = vi.fn()
  const onCancel = vi.fn()
  await act(async () => {
    renderWithConsoleQuery(
      <ModerationSettingModal data={moderation} onSave={onSave} onCancel={onCancel} />,
    )
  })
  return { onSave, onCancel }
}

const openExtensionForm = async (
  user: ReturnType<typeof userEvent.setup>,
  apiKey = 'new-secret',
) => {
  await user.click(await screen.findByRole('button', { name: /Existing API/ }))
  await user.click(await screen.findByRole('button', { name: 'common.operation.add' }))
  const dialog = await screen.findByRole('dialog', { name: childDialogName })
  await user.type(
    within(dialog).getByRole('textbox', { name: 'common.apiBasedExtension.modal.name.title' }),
    newExtension.name,
  )
  await user.type(
    within(dialog).getByRole('textbox', {
      name: 'common.apiBasedExtension.modal.apiEndpoint.title',
    }),
    newExtension.api_endpoint,
  )
  await user.type(
    within(dialog).getByRole('textbox', { name: 'common.apiBasedExtension.modal.apiKey.title' }),
    apiKey,
  )
  return dialog
}

beforeEach(() => {
  getExtensions.mockResolvedValue([existingExtension])
  createExtension.mockReset()
})

it.each(['success', 'failure'] as const)(
  'preserves the moderation draft while a nested extension submission is pending and after %s',
  async (outcome) => {
    const user = userEvent.setup()
    let resolveCreation!: (response: ApiBasedExtensionResponse) => void
    let rejectCreation!: (error: Error) => void
    const creation = new Promise<ApiBasedExtensionResponse>((resolve, reject) => {
      resolveCreation = resolve
      rejectCreation = reject
    })
    createExtension.mockReturnValue(creation)
    const { onSave, onCancel } = await renderModal()
    await user.click(screen.getByRole('switch', { name: outputLabel }))
    const dialog = await openExtensionForm(user)
    const childSave = within(dialog).getByRole('button', { name: 'common.operation.save' })

    await user.click(childSave)

    await waitFor(() => expect(createExtension).toHaveBeenCalledTimes(1))
    expect(createExtension.mock.calls[0]?.[0]).toEqual({
      body: {
        name: newExtension.name,
        api_endpoint: newExtension.api_endpoint,
        api_key: newExtension.api_key,
      },
    })
    expect(childSave).toBeDisabled()
    expect(onSave).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()

    if (outcome === 'success') {
      await act(async () => resolveCreation(newExtension))
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: childDialogName })).not.toBeInTheDocument(),
      )
    } else {
      await act(async () => rejectCreation(new Error('Creation failed')))
      await waitFor(() => expect(childSave).toBeEnabled())
      expect(screen.getByRole('dialog', { name: childDialogName })).toBeInTheDocument()
      await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
    }

    expect(onSave).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Existing API/ })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: outputLabel })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      ...moderation,
      config: {
        ...moderation.config,
        outputs_config: { enabled: true, preset_response: '' },
      },
    })
  },
)

it('keeps nested extension validation and resubmission from submitting the moderation draft', async () => {
  const user = userEvent.setup()
  createExtension.mockResolvedValue(newExtension)
  const { onSave, onCancel } = await renderModal()
  const dialog = await openExtensionForm(user, 'a')

  await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

  expect(
    await within(dialog).findByText('common.apiBasedExtension.modal.apiKey.lengthError'),
  ).toBeInTheDocument()
  expect(createExtension).not.toHaveBeenCalled()
  expect(onSave).not.toHaveBeenCalled()
  expect(onCancel).not.toHaveBeenCalled()
  const apiKey = within(dialog).getByRole('textbox', {
    name: 'common.apiBasedExtension.modal.apiKey.title',
  })
  await user.clear(apiKey)
  await user.type(apiKey, newExtension.api_key)
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: childDialogName })).not.toBeInTheDocument(),
  )
  expect(createExtension).toHaveBeenCalledTimes(1)
  expect(onSave).not.toHaveBeenCalled()
  expect(onCancel).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: /Existing API/ })).toBeInTheDocument()
})
