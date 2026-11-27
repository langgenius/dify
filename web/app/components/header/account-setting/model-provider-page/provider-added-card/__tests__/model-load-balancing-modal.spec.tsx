import type { consoleClient } from '@/service/console'
import { zModelCredentialResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { ModelCredentialDialog } from '@/app/components/header/account-setting/model-provider-page/model-modal/dialog'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import { consoleQuery } from '@/service/console'
import { createHttpError } from '@/service/http-error'
import { createProviderResponseFixture } from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import {
  ConfigurationMethodEnum,
  FormTypeEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '../../declarations'
import { modelProviderDetailsQueryOptions } from '../../utils'
import ModelLoadBalancingModal from '../model-load-balancing-modal'

const api = vi.hoisted(() => ({
  save: vi.fn<typeof consoleClient.workspaces.current.modelProviders.byProvider.models.post>(),
  removeModel:
    vi.fn<typeof consoleClient.workspaces.current.modelProviders.byProvider.models.delete>(),
  credentials:
    vi.fn<
      typeof consoleClient.workspaces.current.modelProviders.byProvider.models.credentials.get
    >(),
  remove:
    vi.fn<
      typeof consoleClient.workspaces.current.modelProviders.byProvider.models.credentials.delete
    >(),
  create:
    vi.fn<typeof consoleClient.workspaces.current.modelProviders.byProvider.credentials.post>(),
  edit: vi.fn<typeof consoleClient.workspaces.current.modelProviders.byProvider.credentials.put>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.modelProviders.byProvider.models.credentials.delete': api.remove,
      'workspaces.current.modelProviders.byProvider.credentials.post': api.create,
      'workspaces.current.modelProviders.byProvider.credentials.put': api.edit,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.byProvider.models.credentials.get': api.credentials,
      'workspaces.current.modelProviders.byProvider.credentials.get': async () => ({
        credentials: { api_key: 'same-key' },
      }),
      'workspaces.current.modelProviders.byProvider.models.post': api.save,
      'workspaces.current.modelProviders.byProvider.models.delete': api.removeModel,
    }),
  }
})
const schema = {
  max_length: 1024,
  show_on: [],
  variable: 'api_key',
  type: FormTypeEnum.secretInput,
  label: { en_US: 'API Key' },
  required: true,
  placeholder: { en_US: 'Enter API key' },
}
const mockProvider = modelProviderDetailsQueryOptions().select!({
  data: [
    createProviderResponseFixture({
      provider: 'test-provider',
      configurate_methods: [
        ConfigurationMethodEnum.predefinedModel,
        ConfigurationMethodEnum.customizableModel,
      ],
      provider_credential_schema: { credential_form_schemas: [schema] },
      model_credential_schema: {
        model: { label: { en_US: 'Model' }, placeholder: { en_US: 'Model name' } },
        credential_form_schemas: [schema],
      },
    }),
  ],
}).data[0]!
const mockModel = {
  model: 'gpt-4',
  model_type: ModelTypeEnum.textGeneration,
  label: { en_US: 'GPT-4', zh_Hans: 'GPT-4' },
  model_properties: {},
  fetch_from: ConfigurationMethodEnum.predefinedModel,
  status: ModelStatusEnum.active,
  deprecated: false,
  load_balancing_enabled: true,
  has_invalid_load_balancing_configs: false,
}
let credentialData: Awaited<ReturnType<typeof api.credentials>>
const renderModal = (
  configurateMethod: ConfigurationMethodEnum = ConfigurationMethodEnum.predefinedModel,
) => {
  const onSave = vi.fn()
  const onClose = vi.fn()
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(consoleQuery.workspaces.current.modelProviders.get.queryKey(), {
    data: [],
  })
  const rendered = renderWithConsoleQuery(
    <NuqsTestingAdapter>
      <>
        <ModelLoadBalancingModal
          provider={mockProvider}
          model={{ ...mockModel, fetch_from: configurateMethod }}
          configurateMethod={configurateMethod}
          currentCustomConfigurationModelFixedFields={{
            __model_name: mockModel.model,
            __model_type: mockModel.model_type,
          }}
          open
          onSave={onSave}
          onClose={onClose}
        />
        <AppToaster timeout={0} />
        <ModelCredentialDialog />
      </>
    </NuqsTestingAdapter>,
    {
      queryClient,
      features: { model_load_balancing_enabled: true },
      workspacePermissionKeys: ['credential.use', 'credential.create', 'credential.manage'],
    },
  )
  return { ...rendered, user: userEvent.setup(), onSave, onClose }
}
const saveButton = () => screen.getByRole('button', { name: 'common.operation.save' })
const addCredential = () =>
  screen.getByRole('button', { name: 'modelProvider.modelProvider.auth.addCredential' })
beforeEach(() => {
  credentialData = zModelCredentialResponse.parse({
    credentials: {},
    load_balancing: {
      enabled: true,
      configs: [
        {
          in_cooldown: false,
          ttl: 0,
          id: 'cfg-1',
          credential_id: 'cred-1',
          enabled: true,
          name: 'Default',
          credentials: { api_key: 'same-key' },
        },
        {
          in_cooldown: false,
          ttl: 0,
          id: 'cfg-2',
          credential_id: 'cred-2',
          enabled: true,
          name: 'Backup',
          credentials: { api_key: 'backup-key' },
        },
      ],
    },
    current_credential_id: 'cred-1',
    current_credential_name: 'Default',
    available_credentials: [
      { credential_id: 'cred-1', credential_name: 'Default' },
      { credential_id: 'cred-2', credential_name: 'Backup' },
      { credential_id: 'cred-3', credential_name: 'New Key' },
    ],
  })
  api.credentials.mockReset().mockImplementation(async () => structuredClone(credentialData))
  api.save.mockReset().mockResolvedValue({ result: 'success' })
  api.remove.mockReset().mockImplementation(async ({ query: { credential_id } }) => {
    credentialData.available_credentials = credentialData.available_credentials.filter(
      (c) => c.credential_id !== credential_id,
    )
    credentialData.load_balancing.configs = credentialData.load_balancing.configs.filter(
      (c) => c.credential_id !== credential_id,
    )
    if (credentialData.current_credential_id === credential_id) {
      credentialData.current_credential_id = null
      credentialData.current_credential_name = null
    }
    return { result: 'success' }
  })
  api.create.mockReset().mockImplementation(async ({ body }) => {
    credentialData.available_credentials.push({
      credential_id: 'cred-new',
      credential_name: body.name ?? 'Unnamed Key',
    })
    return { result: 'success' }
  })
  api.edit.mockReset().mockImplementation(async ({ body }) => {
    credentialData.available_credentials = credentialData.available_credentials.map((c) =>
      c.credential_id === body.credential_id
        ? { ...c, credential_name: body.name ?? 'Unnamed Key' }
        : c,
    )
    return { result: 'success' }
  })
})
afterEach(() => act(() => toast.dismiss()))

describe('ModelLoadBalancingModal', () => {
  it('waits for credentials before offering save', async () => {
    const request = createDeferred<typeof credentialData>()
    api.credentials.mockReturnValue(request.promise)
    renderModal()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.save' })).not.toBeInTheDocument()
    await act(async () => request.resolve(credentialData))
    expect(await screen.findByRole('switch', { name: 'Default' })).toBeChecked()
    expect(saveButton()).toBeEnabled()
  })

  it('shows a failed first credentials load with a retry instead of loading forever', async () => {
    const user = userEvent.setup()
    api.credentials.mockRejectedValueOnce(
      createHttpError(
        { status: 500, statusText: '', headers: new Headers() },
        { message: 'Backend text' },
      ),
    )
    renderModal()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(await screen.findByRole('switch', { name: 'Default' })).toBeChecked()
    expect(api.credentials).toHaveBeenCalledTimes(2)
  })

  it('saves an edited draft while credentials refresh in the background', async () => {
    const { user, queryClient, onSave, onClose } = renderModal()
    await screen.findByRole('switch', { name: 'Default' })
    await user.click(
      screen.getByRole('button', { name: 'modelProvider.modelProvider.auth.providerManaged' }),
    )

    const refresh = createDeferred<typeof credentialData>()
    api.credentials.mockReturnValueOnce(refresh.promise)
    const key =
      consoleQuery.workspaces.current.modelProviders.byProvider.models.credentials.get.key()
    void queryClient.invalidateQueries({ queryKey: key })
    await waitFor(() => expect(api.credentials).toHaveBeenCalledTimes(2))

    expect(saveButton()).toBeEnabled()
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(api.save.mock.calls[0]?.[0].body.load_balancing?.enabled).toBe(false)
    await act(async () => refresh.resolve(credentialData))
  })

  it('waits for a credential deletion and reconciliation before saving the replacement', async () => {
    const { user } = renderModal(ConfigurationMethodEnum.customizableModel)
    await screen.findByRole('switch', { name: 'Default' })
    await user.click(screen.getByRole('button', { name: /specifyModelCredential$/ }))
    await user.click(screen.getByRole('button', { name: 'Default' }))
    await user.click(screen.getByRole('button', { name: 'Backup' }))
    expect(saveButton()).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Backup' }))

    const deletion = createDeferred<{ result: string }>()
    const refresh = createDeferred<typeof credentialData>()
    const remove = api.remove.getMockImplementation()!
    api.remove.mockImplementationOnce(async (input) => {
      await deletion.promise
      return remove(input)
    })
    api.credentials.mockReturnValueOnce(refresh.promise)
    await user.click(screen.getAllByRole('button', { name: 'common.operation.delete' })[1]!)
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'common.operation.confirm',
      }),
    )
    expect(api.remove).toHaveBeenCalledTimes(1)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.save' })).not.toBeInTheDocument()
    await act(async () => deletion.resolve({ result: 'success' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await waitFor(() => expect(api.credentials).toHaveBeenCalledTimes(2))
    expect(saveButton()).toBeDisabled()
    await user.click(saveButton())
    expect(api.save).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Default' }))
    expect(screen.getByRole('button', { name: 'New Key' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Backup' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')

    await act(async () => refresh.resolve(credentialData))
    await waitFor(() => expect(saveButton()).toBeEnabled())
    await user.click(saveButton())
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1))
    expect(api.save.mock.calls[0]?.[0].body).toMatchObject({
      credential_id: 'cred-1',
      load_balancing: { configs: [expect.objectContaining({ credential_id: 'cred-1' })] },
    })
  })

  it('does not save a deleted active credential if the reconciliation fails', async () => {
    const { user } = renderModal(ConfigurationMethodEnum.customizableModel)
    await screen.findByRole('switch', { name: 'Default' })
    await user.click(screen.getByRole('button', { name: /specifyModelCredential$/ }))
    await user.click(screen.getByRole('button', { name: 'Default' }))

    const refresh = createDeferred<typeof credentialData>()
    api.credentials.mockReturnValueOnce(refresh.promise)
    await user.click(screen.getAllByRole('button', { name: 'common.operation.delete' })[0]!)
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'common.operation.confirm',
      }),
    )
    await waitFor(() => expect(api.credentials).toHaveBeenCalledTimes(2))
    await act(async () => refresh.reject(new Error('Credential refresh failed')))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(saveButton()).toBeDisabled()
    await user.click(saveButton())
    expect(api.save).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /authRemoved$/ }))
    expect(screen.queryByRole('button', { name: 'Default' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Backup' }))
    await waitFor(() => expect(saveButton()).toBeEnabled())
    await user.click(saveButton())
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1))
    expect(api.save.mock.calls[0]?.[0].body.credential_id).toBe('cred-2')
  })

  it('masks unchanged secrets in the request without changing cached credentials', async () => {
    const { user, queryClient, onSave, onClose } = renderModal()
    await screen.findByRole('switch', { name: 'Default' })
    const key =
      consoleQuery.workspaces.current.modelProviders.byProvider.models.credentials.get.queryOptions(
        {
          input: {
            params: { provider: mockProvider.provider },
            query: {
              model: mockModel.model,
              model_type: mockModel.model_type,
              config_from: 'predefined-model',
            },
          },
        },
      ).queryKey
    const snapshot = structuredClone(queryClient.getQueryData(key))
    await user.click(saveButton())
    await waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith('test-provider'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(api.save).toHaveBeenCalledExactlyOnceWith({
      body: {
        credential_id: 'cred-1',
        config_from: 'predefined-model',
        model: 'gpt-4',
        model_type: 'llm',
        load_balancing: {
          enabled: true,
          configs: credentialData.load_balancing.configs.map((config) => ({
            ...config,
            credentials: { api_key: '[__HIDDEN__]' },
          })),
        },
      },
      params: { provider: 'test-provider' },
    })
    expect(queryClient.getQueryData(key)).toEqual(snapshot)
    expect(
      queryClient.getQueryState(consoleQuery.workspaces.current.modelProviders.get.queryKey())
        ?.isInvalidated,
    ).toBe(true)
  })

  it('requires two enabled entries and saves the actual removal and replacement', async () => {
    const { user } = renderModal()
    await screen.findByRole('switch', { name: 'Default' })
    await user.click(screen.getByRole('switch', { name: 'Backup' }))
    expect(saveButton()).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'common.operation.remove Backup' }))
    expect(screen.queryByRole('switch', { name: 'Backup' })).not.toBeInTheDocument()
    await user.click(addCredential())
    await user.click(await screen.findByRole('button', { name: 'New Key' }))
    expect(saveButton()).toBeEnabled()
    await user.click(saveButton())
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1))
    expect(api.save.mock.calls[0]![0].body.load_balancing?.configs).toEqual([
      { ...credentialData.load_balancing.configs[0], credentials: { api_key: '[__HIDDEN__]' } },
      { credential_id: 'cred-3', name: 'New Key', enabled: true, credentials: {} },
    ])
  })

  it.each(['Create credential', 'Rename credential'])(
    'preserves local edits when %s refreshes server credentials',
    async (action) => {
      credentialData.load_balancing.configs.push({
        ...credentialData.load_balancing.configs[0]!,
        id: 'cfg-3',
        credential_id: 'cred-3',
        name: 'New Key',
      })
      const { user } = renderModal()
      await screen.findByRole('switch', { name: 'Default' })
      await user.click(screen.getByRole('switch', { name: 'Backup' }))
      const refresh = createDeferred<typeof credentialData>()
      await user.click(addCredential())
      if (action === 'Create credential') {
        await user.click(await screen.findByText('modelProvider.modelProvider.auth.addApiKey'))
      } else {
        await user.click(screen.getAllByRole('button', { name: 'common.operation.edit' })[0]!)
      }
      const name = await screen.findByRole('textbox', { name: 'plugin.auth.authorizationName' })
      await user.clear(name)
      await user.type(name, action === 'Create credential' ? 'Created Key' : 'Renamed Key')
      if (action === 'Create credential')
        await user.type(screen.getByPlaceholderText('Enter API key'), 'new-key')
      api.credentials.mockReturnValueOnce(refresh.promise)
      await user.click(saveButton())
      await waitFor(() => expect(api.credentials).toHaveBeenCalledTimes(2))
      await waitFor(() =>
        expect(
          screen.queryByRole('textbox', { name: 'plugin.auth.authorizationName' }),
        ).not.toBeInTheDocument(),
      )
      expect(saveButton()).toBeDisabled()
      await user.click(saveButton())
      expect(api.save).not.toHaveBeenCalled()
      await act(async () => refresh.resolve(credentialData))
      await screen.findByRole('switch', {
        name: action === 'Create credential' ? 'Created Key' : 'Renamed Key',
      })
      expect(screen.getByRole('switch', { name: 'Backup' })).not.toBeChecked()
      expect(
        action === 'Create credential' ? api.create : api.edit,
      ).toHaveBeenCalledExactlyOnceWith({
        params: { provider: mockProvider.provider },
        body: expect.objectContaining({
          name: action === 'Create credential' ? 'Created Key' : 'Renamed Key',
          model: mockModel.model,
          model_type: mockModel.model_type,
        }),
      })
      // Provider-managed mode permits saving even with fewer than two enabled keys.
      await user.click(
        screen.getByRole('button', { name: 'modelProvider.modelProvider.auth.providerManaged' }),
      )
      await user.click(saveButton())
      await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1))
      const saved = api.save.mock.calls[0]![0].body.load_balancing
      expect(saved?.enabled).toBe(false)
      expect(saved?.configs?.find((entry) => entry.credential_id === 'cred-2')?.enabled).toBe(false)
      if (action === 'Create credential')
        expect(saved?.configs).toContainEqual({
          credential_id: 'cred-new',
          enabled: true,
          name: 'Created Key',
          credentials: {},
        })
      else expect(saved?.configs?.[0]?.name).toBe('Renamed Key')
    },
  )

  it.each([
    {
      through: 'selection',
      removeIndex: 1,
      removed: 'Backup',
      removedId: 'cred-2',
      retained: 'Default',
      retainedId: 'cred-1',
    },
    {
      through: 'addition',
      removeIndex: 0,
      removed: 'Default',
      removedId: 'cred-1',
      retained: 'Backup',
      retainedId: 'cred-2',
    },
  ])(
    'removes a credential through the $through menu while retaining local edits',
    async ({ through, removeIndex, removed, removedId, retained, retainedId }) => {
      const { user } = renderModal(ConfigurationMethodEnum.customizableModel)
      await screen.findByRole('switch', { name: 'Default' })
      await user.click(screen.getByRole('switch', { name: retained }))
      await user.click(
        through === 'addition' ? addCredential() : screen.getByRole('button', { name: 'Default' }),
      )
      await user.click(
        screen.getAllByRole('button', { name: 'common.operation.delete' })[removeIndex]!,
      )
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', {
          name: 'common.operation.confirm',
        }),
      )
      await waitFor(() =>
        expect(api.remove).toHaveBeenCalledExactlyOnceWith({
          params: { provider: 'test-provider' },
          query: { credential_id: removedId, model: 'gpt-4', model_type: 'llm' },
        }),
      )
      await waitFor(() =>
        expect(screen.queryByRole('switch', { name: removed })).not.toBeInTheDocument(),
      )
      expect(screen.getByRole('switch', { name: retained })).not.toBeChecked()
      await user.click(screen.getByRole('button', { name: /specifyModelCredential$/ }))
      if (removedId === 'cred-1') {
        expect(saveButton()).toBeDisabled()
        await user.click(
          screen.getByRole('button', { name: 'modelProvider.modelProvider.auth.modelCredentials' }),
        )
        await user.click(screen.getByRole('button', { name: retained }))
      }
      await user.click(saveButton())
      await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1))
      expect(api.save.mock.calls[0]![0].body.load_balancing).toMatchObject({
        enabled: false,
        configs: [{ credential_id: retainedId, enabled: false }],
      })
    },
  )

  it('saves the selected custom-model credential and provider-managed mode', async () => {
    const { user } = renderModal(ConfigurationMethodEnum.customizableModel)
    await screen.findByRole('switch', { name: 'Default' })
    await user.click(screen.getByRole('button', { name: 'Default' }))
    await user.click(screen.getByRole('button', { name: 'Backup' }))
    await user.click(screen.getByRole('button', { name: /specifyModelCredential$/ }))
    await user.click(saveButton())
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1))
    expect(api.save.mock.calls[0]![0].body).toMatchObject({
      credential_id: 'cred-2',
      config_from: 'custom-model',
      load_balancing: { enabled: false },
    })
  })

  it('blocks dismissal and duplicate submissions while saving and allows retry after failure', async () => {
    const request = createDeferred<{ result: string }>()
    api.save.mockReturnValueOnce(request.promise)
    const { user, onClose, onSave } = renderModal()
    await screen.findByRole('switch', { name: 'Default' })
    await user.dblClick(saveButton())
    expect(saveButton()).toHaveFocus()
    await user.keyboard('{Enter}')
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(saveButton()).toHaveAttribute('aria-disabled', 'true')
    expect(api.save).toHaveBeenCalledTimes(1)
    await act(async () => request.reject(new Error('Save failed')))
    expect(await screen.findByText('Save failed')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
    expect(saveButton()).toBeEnabled()
    await user.click(saveButton())
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(api.save.mock.calls[1]![0].body).toEqual(api.save.mock.calls[0]![0].body)
  })

  it('cancels without saving the edited draft', async () => {
    const { user, onClose } = renderModal()
    await screen.findByRole('switch', { name: 'Default' })
    await user.click(screen.getByRole('switch', { name: 'Backup' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(api.save).not.toHaveBeenCalled()
  })

  it('does not start a save while the model is being removed', async () => {
    const request = createDeferred<Awaited<ReturnType<typeof api.removeModel>>>()
    api.removeModel.mockReturnValueOnce(request.promise)
    const { user, onClose } = renderModal(ConfigurationMethodEnum.customizableModel)
    await screen.findByRole('switch', { name: 'Default' })
    await user.click(screen.getByRole('button', { name: /removeModel$/ }))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'common.operation.confirm',
      }),
    )
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(api.removeModel).toHaveBeenCalledTimes(1)
    expect(saveButton()).toBeDisabled()
    await user.click(saveButton())
    expect(api.save).not.toHaveBeenCalled()
    await act(async () => request.resolve({ result: 'success' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
