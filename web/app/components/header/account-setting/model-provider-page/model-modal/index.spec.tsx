import type { Credential, CredentialFormSchema, ModelProvider } from '../declarations'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  ConfigurationMethodEnum,
  CurrentSystemQuotaTypeEnum,
  CustomConfigurationStatusEnum,
  ModelModalModeEnum,
  ModelTypeEnum,
  PreferredProviderTypeEnum,
  QuotaUnitEnum,
} from '../declarations'
import ModelModal from './index'

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
  isCurrentWorkspaceManager: true,
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

type FormResponse = {
  isCheckValidated: boolean
  values: Record<string, unknown>
}
const mockFormState = vi.hoisted(() => ({
  responses: [] as FormResponse[],
  setFieldValue: vi.fn(),
}))

vi.mock('../model-auth/hooks', () => ({
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

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({ isCurrentWorkspaceManager: mockState.isCurrentWorkspaceManager }),
}))

vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: () => (value: { en_US: string }) => value.en_US,
}))

vi.mock('../hooks', () => ({
  useLanguage: () => 'en_US',
}))

vi.mock('@/app/components/base/form/form-scenarios/auth', async () => {
  const React = await import('react')
  const AuthForm = React.forwardRef(({
    onChange,
  }: {
    onChange?: (field: string, value: string) => void
  }, ref: React.ForwardedRef<{ getFormValues: () => FormResponse, getForm: () => { setFieldValue: (field: string, value: string) => void } }>) => {
    React.useImperativeHandle(ref, () => ({
      getFormValues: () => mockFormState.responses.shift() || { isCheckValidated: false, values: {} },
      getForm: () => ({ setFieldValue: mockFormState.setFieldValue }),
    }))
    return (
      <div>
        <button type="button" onClick={() => onChange?.('__model_name', 'updated-model')}>Model Name Change</button>
      </div>
    )
  })

  return { default: AuthForm }
})

vi.mock('../model-auth', () => ({
  CredentialSelector: ({ onSelect }: { onSelect: (credential: Credential & { addNewCredential?: boolean }) => void }) => (
    <div>
      <button type="button" onClick={() => onSelect({ credential_id: 'existing' })}>Choose Existing</button>
      <button type="button" onClick={() => onSelect({ credential_id: 'new', addNewCredential: true })}>Add New</button>
    </div>
  ),
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
        last_used: 0,
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
  const view = render(<ModelModal {...props} />)
  return {
    ...props,
    unmount: view.unmount,
  }
}

describe('ModelModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.isLoading = false
    mockState.credentialData = { credentials: {}, available_credentials: [] }
    mockState.doingAction = false
    mockState.deleteCredentialId = null
    mockState.isCurrentWorkspaceManager = true
    mockState.formSchemas = []
    mockState.formValues = {}
    mockState.modelNameAndTypeFormSchemas = []
    mockState.modelNameAndTypeFormValues = {}
    mockFormState.responses = []
  })

  it('should show title, description, and loading state for predefined models', () => {
    mockState.isLoading = true

    const predefined = renderModal()

    expect(screen.getByText('common.modelProvider.auth.apiKeyModal.title')).toBeInTheDocument()
    expect(screen.getByText('common.modelProvider.auth.apiKeyModal.desc')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeDisabled()

    predefined.unmount()
    const customizable = renderModal({ configurateMethod: ConfigurationMethodEnum.customizableModel })
    expect(screen.queryByText('common.modelProvider.auth.apiKeyModal.desc')).not.toBeInTheDocument()
    customizable.unmount()

    mockState.credentialData = { credentials: {}, available_credentials: [] }
    renderModal({ mode: ModelModalModeEnum.configModelCredential, model: { model: 'gpt-4', model_type: ModelTypeEnum.textGeneration } })
    expect(screen.getByText('common.modelProvider.auth.addModelCredential')).toBeInTheDocument()
  })

  it('should reveal the credential label when adding a new credential', () => {
    renderModal({ mode: ModelModalModeEnum.addCustomModelToModelList })

    expect(screen.queryByText('common.modelProvider.auth.modelCredential')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Add New'))

    expect(screen.getByText('common.modelProvider.auth.modelCredential')).toBeInTheDocument()
  })

  it('should call onCancel when the cancel button is clicked', () => {
    const { onCancel } = renderModal()

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('should call onCancel when the escape key is pressed', () => {
    const { onCancel } = renderModal()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('should confirm deletion when a delete dialog is shown', () => {
    mockState.credentialData = { credentials: { api_key: 'secret' }, available_credentials: [] }
    mockState.deleteCredentialId = 'delete-id'

    const credential: Credential = { credential_id: 'cred-1' }
    const { onCancel } = renderModal({ credential })

    expect(screen.getByText('common.modelProvider.confirmDelete')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    expect(mockHandlers.handleConfirmDelete).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('should handle save flows for different modal modes', async () => {
    mockState.modelNameAndTypeFormSchemas = [{ variable: '__model_name', type: 'text-input' } as unknown as CredentialFormSchema]
    mockState.formSchemas = [{ variable: 'api_key', type: 'secret-input' } as unknown as CredentialFormSchema]
    mockFormState.responses = [
      { isCheckValidated: true, values: { __model_name: 'custom-model', __model_type: ModelTypeEnum.textGeneration } },
      { isCheckValidated: true, values: { __authorization_name__: 'Auth Name', api_key: 'secret' } },
    ]
    const configCustomModel = renderModal({ mode: ModelModalModeEnum.configCustomModel })
    fireEvent.click(screen.getAllByText('Model Name Change')[0])
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.add' }))

    expect(mockFormState.setFieldValue).toHaveBeenCalledWith('__model_name', 'updated-model')
    await waitFor(() => {
      expect(mockHandlers.handleSaveCredential).toHaveBeenCalledWith({
        credential_id: undefined,
        credentials: { api_key: 'secret' },
        name: 'Auth Name',
        model: 'custom-model',
        model_type: ModelTypeEnum.textGeneration,
      })
    })
    expect(configCustomModel.onSave).toHaveBeenCalledWith({ __authorization_name__: 'Auth Name', api_key: 'secret' })
    configCustomModel.unmount()

    mockFormState.responses = [{ isCheckValidated: true, values: { __authorization_name__: 'Model Auth', api_key: 'abc' } }]
    const model = { model: 'gpt-4', model_type: ModelTypeEnum.textGeneration }
    const configModelCredential = renderModal({
      mode: ModelModalModeEnum.configModelCredential,
      model,
      credential: { credential_id: 'cred-123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() => {
      expect(mockHandlers.handleSaveCredential).toHaveBeenCalledWith({
        credential_id: 'cred-123',
        credentials: { api_key: 'abc' },
        name: 'Model Auth',
        model: 'gpt-4',
        model_type: ModelTypeEnum.textGeneration,
      })
    })
    expect(configModelCredential.onSave).toHaveBeenCalledWith({ __authorization_name__: 'Model Auth', api_key: 'abc' })
    configModelCredential.unmount()

    mockFormState.responses = [{ isCheckValidated: true, values: { __authorization_name__: 'Provider Auth', api_key: 'provider-key' } }]
    const configProviderCredential = renderModal({ mode: ModelModalModeEnum.configProviderCredential })
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() => {
      expect(mockHandlers.handleSaveCredential).toHaveBeenCalledWith({
        credential_id: undefined,
        credentials: { api_key: 'provider-key' },
        name: 'Provider Auth',
      })
    })
    configProviderCredential.unmount()

    const addToModelList = renderModal({
      mode: ModelModalModeEnum.addCustomModelToModelList,
      model,
    })
    fireEvent.click(screen.getByText('Choose Existing'))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.add' }))
    expect(mockHandlers.handleActiveCredential).toHaveBeenCalledWith({ credential_id: 'existing' }, model)
    expect(addToModelList.onCancel).toHaveBeenCalled()
    addToModelList.unmount()

    mockFormState.responses = [{ isCheckValidated: true, values: { __authorization_name__: 'New Auth', api_key: 'new-key' } }]
    const addToModelListWithNew = renderModal({
      mode: ModelModalModeEnum.addCustomModelToModelList,
      model,
    })
    fireEvent.click(screen.getByText('Add New'))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.add' }))
    await waitFor(() => {
      expect(mockHandlers.handleSaveCredential).toHaveBeenCalledWith({
        credential_id: undefined,
        credentials: { api_key: 'new-key' },
        name: 'New Auth',
        model: 'gpt-4',
        model_type: ModelTypeEnum.textGeneration,
      })
    })
    addToModelListWithNew.unmount()

    mockFormState.responses = [{ isCheckValidated: false, values: {} }]
    const invalidSave = renderModal({ mode: ModelModalModeEnum.configProviderCredential })
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() => {
      expect(mockHandlers.handleSaveCredential).toHaveBeenCalledTimes(4)
    })
    invalidSave.unmount()

    mockState.credentialData = { credentials: { api_key: 'value' }, available_credentials: [] }
    mockState.formValues = { api_key: 'value' }
    const removable = renderModal({ credential: { credential_id: 'remove-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    expect(mockHandlers.openConfirmDelete).toHaveBeenCalledWith({ credential_id: 'remove-1' }, undefined)
    removable.unmount()
  })
})
