import type { ComponentProps } from 'react'
import type { Credential, CredentialFormSchema, ModelProvider } from '../declarations'
import { fireEvent, render, screen } from '@testing-library/react'
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

const renderModal = (overrides?: Partial<ComponentProps<typeof ModelModal>>) => {
  const provider = createProvider()
  const props = {
    provider,
    configurateMethod: ConfigurationMethodEnum.predefinedModel,
    onCancel: vi.fn(),
    onSave: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  }
  render(<ModelModal {...props} />)
  return props
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
  })

  it('should render title and loading state for predefined credential modal', () => {
    mockState.isLoading = true

    renderModal()

    expect(screen.getByText('common.modelProvider.auth.apiKeyModal.title')).toBeInTheDocument()
    expect(screen.getByText('common.modelProvider.auth.apiKeyModal.desc')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeDisabled()
  })

  it('should render model credential title when mode is configModelCredential', () => {
    renderModal({
      mode: ModelModalModeEnum.configModelCredential,
      model: { model: 'gpt-4', model_type: ModelTypeEnum.textGeneration },
    })

    expect(screen.getByText('common.modelProvider.auth.addModelCredential')).toBeInTheDocument()
  })

  it('should call onCancel when cancel button is clicked', () => {
    const { onCancel } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('should call onCancel when escape key is pressed', () => {
    const { onCancel } = renderModal()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('should call openConfirmDelete when remove button is clicked in edit mode', () => {
    mockState.credentialData = { credentials: { api_key: 'secret' }, available_credentials: [] }
    mockState.formValues = { api_key: 'secret' }
    const credential: Credential = { credential_id: 'cred-1' }

    renderModal({ credential })
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.remove' }))

    expect(mockHandlers.openConfirmDelete).toHaveBeenCalledWith(credential, undefined)
  })

  it('should confirm deletion and close when confirm dialog is shown', () => {
    mockState.credentialData = { credentials: { api_key: 'secret' }, available_credentials: [] }
    mockState.deleteCredentialId = 'cred-1'
    const credential: Credential = { credential_id: 'cred-1' }
    const { onCancel } = renderModal({ credential })

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    expect(mockHandlers.handleConfirmDelete).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
