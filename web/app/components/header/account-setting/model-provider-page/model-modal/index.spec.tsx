import type { ComponentProps } from 'react'
import type { Credential, CredentialFormSchema, CustomModel, ModelProvider } from '../declarations'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
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

const mockFormRef1 = {
  getFormValues: vi.fn(),
  getForm: vi.fn(() => ({ setFieldValue: vi.fn() })),
}

const mockFormRef2 = {
  getFormValues: vi.fn(),
  getForm: vi.fn(() => ({ setFieldValue: vi.fn() })),
}

vi.mock('@/app/components/base/form/form-scenarios/auth', () => ({
  default: React.forwardRef((props: { formSchemas: Record<string, unknown>[], onChange?: (f: string, v: string) => void }, ref: React.ForwardedRef<unknown>) => {
    React.useImperativeHandle(ref, () => {
      // Return the mock depending on schemas passed (hacky but works for refs)
      if (props.formSchemas.length > 0 && props.formSchemas[0].name === '__model_name')
        return mockFormRef1
      return mockFormRef2
    })
    return (
      <div data-testid="auth-form" onClick={() => props.onChange?.('test-field', 'val')}>
        AuthForm Mock (
        {props.formSchemas.length}
        {' '}
        fields)
      </div>
    )
  }),
}))

vi.mock('../model-auth', () => ({
  CredentialSelector: ({ onSelect }: { onSelect: (val: unknown) => void }) => (
    <button onClick={() => onSelect({ addNewCredential: true })} data-testid="credential-selector">
      Select Credential
    </button>
  ),
  useAuth: vi.fn(),
  useCredentialData: vi.fn(),
  useModelFormSchemas: vi.fn(),
}))

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

    // reset form refs
    mockFormRef1.getFormValues.mockReturnValue({ isCheckValidated: true, values: { __model_name: 'test', __model_type: ModelTypeEnum.textGeneration } })
    mockFormRef2.getFormValues.mockReturnValue({ isCheckValidated: true, values: { __authorization_name__: 'test_auth', api_key: 'sk-test' } })
  })

  it('should render title and loading state for predefined credential modal', () => {
    mockState.isLoading = true
    renderModal()
    expect(screen.getByText('common.modelProvider.auth.apiKeyModal.title')).toBeInTheDocument()
    expect(screen.getByText('common.modelProvider.auth.apiKeyModal.desc')).toBeInTheDocument()
  })

  it('should render model credential title when mode is configModelCredential', () => {
    renderModal({
      mode: ModelModalModeEnum.configModelCredential,
      model: { model: 'gpt-4', model_type: ModelTypeEnum.textGeneration },
    })
    expect(screen.getByText('common.modelProvider.auth.addModelCredential')).toBeInTheDocument()
  })

  it('should render edit credential title when credential exists', () => {
    renderModal({
      mode: ModelModalModeEnum.configModelCredential,
      credential: { credential_id: '1' } as unknown as Credential,
    })
    expect(screen.getByText('common.modelProvider.auth.editModelCredential')).toBeInTheDocument()
  })

  it('should change title to Add Model when mode is configCustomModel', () => {
    mockState.modelNameAndTypeFormSchemas = [{ variable: '__model_name', type: 'text' } as unknown as CredentialFormSchema]
    renderModal({ mode: ModelModalModeEnum.configCustomModel })
    expect(screen.getByText('common.modelProvider.auth.addModel')).toBeInTheDocument()
  })

  it('should validate and fail save if form is invalid in configCustomModel mode', async () => {
    mockState.modelNameAndTypeFormSchemas = [{ variable: '__model_name', type: 'text' } as unknown as CredentialFormSchema]
    mockFormRef1.getFormValues.mockReturnValue({ isCheckValidated: false, values: {} })
    renderModal({ mode: ModelModalModeEnum.configCustomModel })
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.add' }))
    expect(mockHandlers.handleSaveCredential).not.toHaveBeenCalled()
  })

  it('should validate and save new credential and model in configCustomModel mode', async () => {
    mockState.modelNameAndTypeFormSchemas = [{ variable: '__model_name', type: 'text' } as unknown as CredentialFormSchema]
    const props = renderModal({ mode: ModelModalModeEnum.configCustomModel })
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.add' }))

    await waitFor(() => {
      expect(mockHandlers.handleSaveCredential).toHaveBeenCalledWith({
        credential_id: undefined,
        credentials: { api_key: 'sk-test' },
        name: 'test_auth',
        model: 'test',
        model_type: ModelTypeEnum.textGeneration,
      })
      expect(props.onSave).toHaveBeenCalled()
    })
  })

  it('should save credential only in standard configProviderCredential mode', async () => {
    const { onSave } = renderModal({ mode: ModelModalModeEnum.configProviderCredential })
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() => {
      expect(mockHandlers.handleSaveCredential).toHaveBeenCalledWith({
        credential_id: undefined,
        credentials: { api_key: 'sk-test' },
        name: 'test_auth',
      })
      expect(onSave).toHaveBeenCalled()
    })
  })

  it('should save active credential and cancel when picking existing credential in addCustomModelToModelList mode', async () => {
    renderModal({ mode: ModelModalModeEnum.addCustomModelToModelList, model: { model: 'm1', model_type: ModelTypeEnum.textGeneration } as unknown as CustomModel })
    // By default selected is undefined so button clicks form
    // Let's not click credential selector, so it evaluates without it. If selectedCredential is undefined, form validation is checked.
    mockFormRef2.getFormValues.mockReturnValue({ isCheckValidated: false, values: {} })
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.add' }))
    expect(mockHandlers.handleSaveCredential).not.toHaveBeenCalled()
  })

  it('should save active credential when picking existing credential in addCustomModelToModelList mode', async () => {
    renderModal({ mode: ModelModalModeEnum.addCustomModelToModelList, model: { model: 'm2', model_type: ModelTypeEnum.textGeneration } as unknown as CustomModel })

    // Select existing credential (addNewCredential: true simulates new but we can simulate false if we just hack the mocked state in the component, but it's internal.
    // The credential selector sets selectedCredential.
    fireEvent.click(screen.getByTestId('credential-selector')) // Sets addNewCredential = true internally, so it proceeds to form save

    mockFormRef2.getFormValues.mockReturnValue({ isCheckValidated: true, values: { __authorization_name__: 'auth', api: 'key' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.add' }))

    await waitFor(() => {
      expect(mockHandlers.handleSaveCredential).toHaveBeenCalledWith({
        credential_id: undefined,
        credentials: { api: 'key' },
        name: 'auth',
        model: 'm2',
        model_type: ModelTypeEnum.textGeneration,
      })
    })
  })

  it('should open and confirm deletion of credential', () => {
    mockState.credentialData = { credentials: { api_key: '123' }, available_credentials: [] }
    mockState.formValues = { api_key: '123' } // To trigger isEditMode = true
    const credential = { credential_id: 'c1' } as unknown as Credential
    renderModal({ credential })

    // Open Delete Confirm
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    expect(mockHandlers.openConfirmDelete).toHaveBeenCalledWith(credential, undefined)

    // Simulate the dialog appearing and confirming
    mockState.deleteCredentialId = 'c1'
    renderModal({ credential }) // Re-render logic mock
    fireEvent.click(screen.getAllByRole('button', { name: 'common.operation.confirm' })[0])

    expect(mockHandlers.handleConfirmDelete).toHaveBeenCalled()
  })

  it('should bind escape key to cancel', () => {
    const props = renderModal()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(props.onCancel).toHaveBeenCalled()
  })
})
