import type * as React from 'react'
import type { Credential, CredentialFormSchema, ModelProvider } from '../../declarations'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import {
  ConfigurationMethodEnum,
  CurrentSystemQuotaTypeEnum,
  CustomConfigurationStatusEnum,
  FormTypeEnum,
  ModelModalModeEnum,
  ModelTypeEnum,
  PreferredProviderTypeEnum,
  QuotaUnitEnum,
} from '../../declarations'
import ModelModal from '../index'

type CredentialData = {
  credentials: Record<string, unknown>
  available_credentials: Credential[]
}

type ModelFormSchemas = {
  formSchemas: CredentialFormSchema[]
  formValues: Record<string, unknown>
  modelNameAndTypeFormSchemas: CredentialFormSchema[]
  modelNameAndTypeFormValues: Record<string, unknown>
}

const mockState = vi.hoisted(() => ({
  isLoading: false,
  credentialData: { credentials: {}, available_credentials: [] } as CredentialData,
  doingAction: false,
  deleteCredentialId: null as string | null,
  workspacePermissionKeys: ['credential.use', 'credential.create', 'credential.manage'] as string[],
  formSchemas: [] as CredentialFormSchema[],
  formValues: {} as Record<string, unknown>,
  modelNameAndTypeFormSchemas: [] as CredentialFormSchema[],
  modelNameAndTypeFormValues: {} as Record<string, unknown>,
}))

const mockHandlers = vi.hoisted(() => ({
  handleSaveCredential: vi.fn(),
  handleConfirmDelete: vi.fn(),
  closeConfirmDelete: vi.fn(),
  openConfirmDelete: vi.fn(),
  handleActiveCredential: vi.fn(),
}))

vi.mock('../../model-auth/hooks', () => ({
  useCredentialData: () => ({
    isLoading: mockState.isLoading,
    credentialData: mockState.credentialData,
  }),
  useAuth: () => ({
    handleSaveCredential: mockHandlers.handleSaveCredential,
    handleConfirmDelete: mockHandlers.handleConfirmDelete,
    deleteCredentialId: mockState.deleteCredentialId,
    closeConfirmDelete: mockHandlers.closeConfirmDelete,
    openConfirmDelete: mockHandlers.openConfirmDelete,
    doingAction: mockState.doingAction,
    handleActiveCredential: mockHandlers.handleActiveCredential,
  }),
  useModelFormSchemas: (): ModelFormSchemas => ({
    formSchemas: mockState.formSchemas,
    formValues: mockState.formValues,
    modelNameAndTypeFormSchemas: mockState.modelNameAndTypeFormSchemas,
    modelNameAndTypeFormValues: mockState.modelNameAndTypeFormValues,
  }),
}))

const createI18n = (text: string) => ({ en_US: text, zh_Hans: text })

const createProvider = (overrides?: Partial<ModelProvider>): ModelProvider => ({
  provider: 'openai',
  label: createI18n('OpenAI'),
  help: {
    title: createI18n('Help'),
    url: createI18n('https://example.com'),
  },
  icon_small: createI18n('icon'),
  supported_model_types: [ModelTypeEnum.textGeneration],
  configurate_methods: [ConfigurationMethodEnum.predefinedModel],
  provider_credential_schema: { credential_form_schemas: [] },
  model_credential_schema: {
    model: { label: createI18n('Model'), placeholder: createI18n('Model') },
    credential_form_schemas: [],
  },
  preferred_provider_type: PreferredProviderTypeEnum.system,
  custom_configuration: {
    status: CustomConfigurationStatusEnum.active,
    available_credentials: [],
    custom_models: [],
    can_added_models: [],
  },
  system_configuration: {
    enabled: true,
    current_quota_type: CurrentSystemQuotaTypeEnum.trial,
    quota_configurations: [
      {
        quota_type: CurrentSystemQuotaTypeEnum.trial,
        quota_unit: QuotaUnitEnum.times,
        quota_limit: 0,
        quota_used: 0,
        is_valid: true,
      },
    ],
  },
  allow_custom_token: true,
  ...overrides,
})

const renderModal = (overrides?: Partial<React.ComponentProps<typeof ModelModal>>) => {
  const provider = createProvider()
  const props = {
    provider,
    configurateMethod: ConfigurationMethodEnum.predefinedModel,
    onCancel: vi.fn(),
    onSave: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  }
  const view = render(<ModelModal {...props} />, {
    workspacePermissionKeys: mockState.workspacePermissionKeys,
  })
  return {
    ...props,
    unmount: view.unmount,
  }
}

const credentialField = (
  variable: string,
  label: string,
  type: FormTypeEnum = FormTypeEnum.textInput,
): CredentialFormSchema => ({
  name: variable,
  variable,
  label: createI18n(label),
  type,
  required: true,
  show_on: [],
})
beforeEach(() => {
  vi.clearAllMocks()
  mockState.isLoading = false
  mockState.doingAction = false
  mockState.deleteCredentialId = null
  mockState.workspacePermissionKeys = ['credential.use', 'credential.create', 'credential.manage']
  mockState.formSchemas = [
    credentialField('__authorization_name__', 'Authorization name'),
    credentialField('api_key', 'API key', FormTypeEnum.secretInput),
  ]
  mockState.formValues = { __authorization_name__: '', api_key: '' }
  mockState.modelNameAndTypeFormSchemas = []
  mockState.modelNameAndTypeFormValues = {}
  mockState.credentialData = { credentials: {}, available_credentials: [] }
})

const fillCredentials = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByRole('textbox', { name: /Authorization name/ }), 'My credential')
  await user.type(screen.getByLabelText(/API key/), 'secret')
}

it('blocks invalid credentials and submits the values entered in the real form', async () => {
  const user = userEvent.setup()
  const { onSave } = renderModal()
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  expect(mockHandlers.handleSaveCredential).not.toHaveBeenCalled()
  await fillCredentials(user)
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() =>
    expect(mockHandlers.handleSaveCredential).toHaveBeenCalledExactlyOnceWith({
      credential_id: undefined,
      credentials: { api_key: 'secret' },
      name: 'My credential',
    }),
  )
  expect(onSave).toHaveBeenCalledWith({
    __authorization_name__: 'My credential',
    api_key: 'secret',
  })
})

it.each(['model', 'fixed'] as const)(
  'uses the %s model context when saving a model credential',
  async (context) => {
    const user = userEvent.setup()
    renderModal({
      mode: ModelModalModeEnum.configModelCredential,
      ...(context === 'model'
        ? { model: { model: 'bge-m3', model_type: ModelTypeEnum.textEmbedding } }
        : {
            currentCustomConfigurationModelFixedFields: {
              __model_name: 'bge-m3',
              __model_type: ModelTypeEnum.textEmbedding,
            },
          }),
    })
    await fillCredentials(user)
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() =>
      expect(mockHandlers.handleSaveCredential).toHaveBeenCalledWith({
        credential_id: undefined,
        credentials: { api_key: 'secret' },
        name: 'My credential',
        model: 'bge-m3',
        model_type: ModelTypeEnum.textEmbedding,
      }),
    )
  },
)

it('does not save a model credential without model context', async () => {
  const user = userEvent.setup()
  renderModal({ mode: ModelModalModeEnum.configModelCredential })
  await fillCredentials(user)
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  expect(mockHandlers.handleSaveCredential).not.toHaveBeenCalled()
})

it('validates both forms before saving a custom model', async () => {
  const user = userEvent.setup()
  mockState.modelNameAndTypeFormSchemas = [
    credentialField('__model_name', 'Model name'),
    credentialField('__model_type', 'Model type'),
  ]
  mockState.modelNameAndTypeFormValues = {
    __model_name: '',
    __model_type: ModelTypeEnum.textGeneration,
  }
  renderModal({ mode: ModelModalModeEnum.configCustomModel })
  await fillCredentials(user)
  await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
  expect(mockHandlers.handleSaveCredential).not.toHaveBeenCalled()
  await user.type(screen.getByRole('textbox', { name: /Model name/ }), 'custom-model')
  await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
  await waitFor(() =>
    expect(mockHandlers.handleSaveCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'custom-model',
        model_type: ModelTypeEnum.textGeneration,
        credentials: { api_key: 'secret', __model_name: 'custom-model' },
      }),
    ),
  )
})

it.each(['openai', 'langgenius/openai/openai', 'langgenius/azure_openai/azure_openai'])(
  'limits Responses API guidance to official OpenAI providers: %s',
  (provider) => {
    mockState.formSchemas = [
      { ...credentialField('api_protocol', 'Protocol', FormTypeEnum.select), options: [] },
    ]
    renderModal({ provider: createProvider({ provider }) })
    const tip = screen.queryByText('modelProvider.modelProvider.auth.openAIResponsesAPITip')
    if (provider.includes('azure_openai')) expect(tip).not.toBeInTheDocument()
    else expect(tip).toBeInTheDocument()
  },
)
