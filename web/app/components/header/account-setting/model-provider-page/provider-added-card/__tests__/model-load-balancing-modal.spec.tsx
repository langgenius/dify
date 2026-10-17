import type { Credential, ModelItem, ModelProvider } from '../../declarations'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { ConfigurationMethodEnum } from '../../declarations'
import ModelLoadBalancingModal from '../model-load-balancing-modal'

const saveConfig = vi.fn()
const getCredentials = vi.fn()
const deleteCredential = vi.fn()
const refreshModels = vi.fn()
const notifyError = vi.fn()
let credentialData: {
  load_balancing: {
    enabled: boolean
    configs: Array<{
      id: string
      credential_id: string
      enabled: boolean
      name: string
      credentials: { api_key: string }
    }>
  }
  current_credential_id: string
  current_credential_name: string
  available_credentials: Array<{ credential_id: string; credential_name: string }>
}

vi.mock('@/app/notifications', () => ({
  toast: { success: vi.fn(), error: (...args: unknown[]) => notifyError(...args) },
}))
vi.mock('../../hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks')>()),
  useRefreshModel: () => ({ handleRefreshModel: refreshModels }),
  useModelModalHandler: () => vi.fn(),
}))

// Isolate credential creation/editing; keep the selection and deletion flow real.
vi.mock(
  '@/app/components/header/account-setting/model-provider-page/model-auth',
  async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../model-auth')>()),
    AddCredentialInLoadBalancing: ({
      onSelectCredential,
      onUpdate,
    }: {
      onSelectCredential: (credential: Credential) => void
      onUpdate: (
        payload?: { credential: { credential_id: string } },
        values?: Record<string, string>,
      ) => void
    }) => (
      <>
        <button
          onClick={() =>
            onSelectCredential({ credential_id: 'cred-3', credential_name: 'New Key' })
          }
        >
          Select another credential
        </button>
        <button onClick={() => onUpdate(undefined, { __authorization_name__: 'New Key' })}>
          Create credential
        </button>
        <button onClick={() => onUpdate({ credential: { credential_id: 'cred-1' } })}>
          Rename credential
        </button>
      </>
    ),
  }),
)
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.modelProviders.byProvider.models.credentials.delete': ({ query }) =>
        deleteCredential(query),
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.byProvider.models.credentials.get': (...args) =>
        getCredentials(...args),
      'workspaces.current.modelProviders.byProvider.models.post': ({ params, body }) =>
        saveConfig(body, params),
    }),
  }
})

const mockProvider = {
  provider: 'test-provider',
  provider_credential_schema: {
    credential_form_schemas: [{ type: 'secret-input', variable: 'api_key' }],
  },
  model_credential_schema: {
    credential_form_schemas: [{ type: 'secret-input', variable: 'api_key' }],
  },
} as unknown as ModelProvider

const mockModel = {
  model: 'gpt-4',
  model_type: 'llm',
  label: { en_US: 'GPT-4', zh_Hans: 'GPT-4' },
  model_properties: {},
  fetch_from: 'predefined-model',
} as unknown as ModelItem

const renderModal = (
  configurateMethod = ConfigurationMethodEnum.predefinedModel as ConfigurationMethodEnum,
) => {
  const onSave = vi.fn()
  const onClose = vi.fn()
  const rendered = renderWithConsoleQuery(
    <ModelLoadBalancingModal
      provider={mockProvider}
      model={mockModel}
      configurateMethod={configurateMethod}
      open
      onSave={onSave}
      onClose={onClose}
    />,
    {
      features: { model_load_balancing_enabled: true },
      workspacePermissionKeys: ['credential.use', 'credential.create', 'credential.manage'],
    },
  )
  return { ...rendered, user: userEvent.setup(), onSave, onClose }
}
const saveButton = () => screen.getByRole('button', { name: 'common.operation.save' })

beforeEach(() => {
  vi.resetAllMocks()
  credentialData = {
    load_balancing: {
      enabled: true,
      configs: [
        {
          id: 'cfg-1',
          credential_id: 'cred-1',
          enabled: true,
          name: 'Default',
          credentials: { api_key: 'same-key' },
        },
        {
          id: 'cfg-2',
          credential_id: 'cred-2',
          enabled: true,
          name: 'Backup',
          credentials: { api_key: 'backup-key' },
        },
      ],
    },
    current_credential_id: 'cred-1',
    available_credentials: [
      { credential_id: 'cred-1', credential_name: 'Default' },
      { credential_id: 'cred-2', credential_name: 'Backup' },
    ],
    current_credential_name: 'Default',
  }

  getCredentials.mockImplementation(async () => structuredClone(credentialData))
  saveConfig.mockResolvedValue({ result: 'success' })
  deleteCredential.mockImplementation(async ({ credential_id }: { credential_id: string }) => {
    credentialData.available_credentials = credentialData.available_credentials.filter(
      (credential) => credential.credential_id !== credential_id,
    )
    credentialData.load_balancing.configs = credentialData.load_balancing.configs.filter(
      (config) => config.credential_id !== credential_id,
    )
    return { result: 'success' }
  })
})

describe('ModelLoadBalancingModal', () => {
  it('waits for credentials before offering save', async () => {
    const request = createDeferred<typeof credentialData>()
    getCredentials.mockReturnValue(request.promise)
    renderModal()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.save' })).not.toBeInTheDocument()
    await act(async () => request.resolve(credentialData))
    expect(await screen.findByRole('switch', { name: 'Default' })).toBeChecked()
    expect(saveButton()).toBeEnabled()
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
    expect(saveConfig).toHaveBeenCalledExactlyOnceWith(
      {
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
      { provider: 'test-provider' },
    )
    expect(queryClient.getQueryData(key)).toEqual(snapshot)
    expect(refreshModels).toHaveBeenCalledTimes(1)
  })

  it('requires two enabled entries and saves the actual removal and replacement', async () => {
    const { user } = renderModal()
    await screen.findByRole('switch', { name: 'Default' })
    await user.click(screen.getByRole('switch', { name: 'Backup' }))
    expect(saveButton()).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'common.operation.remove Backup' }))
    expect(screen.queryByRole('switch', { name: 'Backup' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Select another credential' }))
    expect(saveButton()).toBeEnabled()
    await user.click(saveButton())
    await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(1))
    expect(saveConfig.mock.calls[0]![0].load_balancing.configs).toEqual([
      { ...credentialData.load_balancing.configs[0], credentials: { api_key: '[__HIDDEN__]' } },
      { credential_id: 'cred-3', name: 'New Key', enabled: true, credentials: {} },
    ])
  })

  it.each(['Create credential', 'Rename credential'])(
    'preserves local edits when %s refreshes server credentials',
    async (action) => {
      const { user } = renderModal()
      await screen.findByRole('switch', { name: 'Default' })
      await user.click(screen.getByRole('switch', { name: 'Backup' }))
      credentialData = {
        ...credentialData,
        available_credentials: [
          { credential_id: 'cred-1', credential_name: 'Renamed Key' },
          { credential_id: 'cred-2', credential_name: 'Backup' },
          { credential_id: 'cred-3', credential_name: 'New Key' },
        ],
      }
      await user.click(screen.getByRole('button', { name: action }))
      await screen.findByRole('switch', {
        name: action === 'Create credential' ? 'New Key' : 'Renamed Key',
      })
      expect(screen.getByRole('switch', { name: 'Backup' })).not.toBeChecked()
      // Provider-managed mode permits saving even with fewer than two enabled keys.
      await user.click(
        screen.getByRole('button', { name: 'modelProvider.modelProvider.auth.providerManaged' }),
      )
      await user.click(saveButton())
      await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(1))
      const saved = saveConfig.mock.calls[0]![0].load_balancing
      expect(saved.enabled).toBe(false)
      expect(
        saved.configs.find((entry: { credential_id: string }) => entry.credential_id === 'cred-2')
          .enabled,
      ).toBe(false)
      if (action === 'Create credential')
        expect(saved.configs).toContainEqual({
          credential_id: 'cred-3',
          enabled: true,
          name: 'New Key',
          credentials: {},
        })
      else expect(saved.configs[0].name).toBe('Renamed Key')
    },
  )

  it('removes deleted model credentials from the draft while retaining local edits', async () => {
    const { user } = renderModal(ConfigurationMethodEnum.customizableModel)
    await screen.findByRole('switch', { name: 'Default' })
    await user.click(screen.getByRole('switch', { name: 'Default' }))
    await user.click(screen.getByRole('button', { name: 'Default' }))
    await user.click(screen.getAllByRole('button', { name: 'common.operation.delete' })[1]!)
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'common.operation.confirm',
      }),
    )
    await waitFor(() =>
      expect(deleteCredential).toHaveBeenCalledExactlyOnceWith({
        credential_id: 'cred-2',
        model: 'gpt-4',
        model_type: 'llm',
      }),
    )
    await waitFor(() =>
      expect(screen.queryByRole('switch', { name: 'Backup' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('switch', { name: 'Default' })).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: /specifyModelCredential$/ }))
    await user.click(saveButton())
    await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(1))
    expect(saveConfig.mock.calls[0]![0].load_balancing).toMatchObject({
      enabled: false,
      configs: [{ credential_id: 'cred-1', enabled: false }],
    })
  })

  it('saves the selected custom-model credential and provider-managed mode', async () => {
    const { user } = renderModal(ConfigurationMethodEnum.customizableModel)
    await screen.findByRole('switch', { name: 'Default' })
    await user.click(screen.getByRole('button', { name: 'Default' }))
    await user.click(screen.getByRole('button', { name: 'Backup' }))
    await user.click(screen.getByRole('button', { name: /specifyModelCredential$/ }))
    await user.click(saveButton())
    await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(1))
    expect(saveConfig.mock.calls[0]![0]).toMatchObject({
      credential_id: 'cred-2',
      config_from: 'custom-model',
      load_balancing: { enabled: false },
    })
  })

  it('prevents duplicate submissions and keeps the draft available for retry after failure', async () => {
    const request = createDeferred<{ result: string }>()
    saveConfig.mockReturnValueOnce(request.promise)
    const { user, onClose, onSave } = renderModal()
    await screen.findByRole('switch', { name: 'Default' })
    await user.dblClick(saveButton())
    expect(saveButton()).toBeDisabled()
    expect(saveConfig).toHaveBeenCalledTimes(1)
    await act(async () => request.reject(new Error('Save failed')))
    expect(notifyError).toHaveBeenCalledWith('Save failed')
    expect(onClose).not.toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
    expect(saveButton()).toBeEnabled()
    await user.click(saveButton())
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(saveConfig.mock.calls[1]![0]).toEqual(saveConfig.mock.calls[0]![0])
  })

  it('cancels without saving the edited draft', async () => {
    const { user, onClose } = renderModal()
    await screen.findByRole('switch', { name: 'Default' })
    await user.click(screen.getByRole('switch', { name: 'Backup' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(saveConfig).not.toHaveBeenCalled()
  })
})
