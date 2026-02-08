import type { PluginDetail } from '@/app/components/plugins/types'
import type { TriggerSubscription } from '@/app/components/workflow/block-selector/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { PluginCategoryEnum, PluginSource } from '@/app/components/plugins/types'
import { TriggerCredentialTypeEnum } from '@/app/components/workflow/block-selector/types'
import { ApiKeyEditModal } from './apikey-edit-modal'
import { EditModal } from './index'
import { ManualEditModal } from './manual-edit-modal'
import { OAuthEditModal } from './oauth-edit-modal'

// ==================== Mock Setup ====================

const mockToastNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  default: { notify: (params: unknown) => mockToastNotify(params) },
}))

const mockParsePluginErrorMessage = vi.fn()
vi.mock('@/utils/error-parser', () => ({
  parsePluginErrorMessage: (error: unknown) => mockParsePluginErrorMessage(error),
}))

// Schema types
type SubscriptionSchema = {
  name: string
  label: Record<string, string>
  type: string
  required: boolean
  default?: string
  description?: Record<string, string>
  multiple: boolean
  auto_generate: null
  template: null
  scope: null
  min: null
  max: null
  precision: null
}

type CredentialSchema = {
  name: string
  label: Record<string, string>
  type: string
  required: boolean
  default?: string
  help?: Record<string, string>
}

const mockPluginStoreDetail = {
  plugin_id: 'test-plugin-id',
  provider: 'test-provider',
  declaration: {
    trigger: {
      subscription_schema: [] as SubscriptionSchema[],
      subscription_constructor: {
        credentials_schema: [] as CredentialSchema[],
        parameters: [] as SubscriptionSchema[],
        oauth_schema: { client_schema: [], credentials_schema: [] },
      },
    },
  },
}

vi.mock('../../store', () => ({
  usePluginStore: (selector: (state: { detail: typeof mockPluginStoreDetail }) => unknown) =>
    selector({ detail: mockPluginStoreDetail }),
}))

const mockRefetch = vi.fn()
vi.mock('../use-subscription-list', () => ({
  useSubscriptionList: () => ({ refetch: mockRefetch }),
}))

const mockUpdateSubscription = vi.fn()
const mockVerifyCredentials = vi.fn()
let mockIsUpdating = false
let mockIsVerifying = false

vi.mock('@/service/use-triggers', () => ({
  useUpdateTriggerSubscription: () => ({
    mutate: mockUpdateSubscription,
    isPending: mockIsUpdating,
  }),
  useVerifyTriggerSubscription: () => ({
    mutate: mockVerifyCredentials,
    isPending: mockIsVerifying,
  }),
}))

vi.mock('@/app/components/plugins/readme-panel/entrance', () => ({
  ReadmeEntrance: ({ pluginDetail }: { pluginDetail: PluginDetail }) => (
    <div data-testid="readme-entrance" data-plugin-id={pluginDetail.id}>ReadmeEntrance</div>
  ),
}))

vi.mock('@/app/components/base/encrypted-bottom', () => ({
  EncryptedBottom: () => <div data-testid="encrypted-bottom">EncryptedBottom</div>,
}))

// Form values storage keyed by form identifier
const formValuesMap = new Map<string, { values: Record<string, unknown>, isCheckValidated: boolean }>()

// Track which modal is being tested to properly identify forms
let currentModalType: 'manual' | 'oauth' | 'apikey' = 'manual'

// Helper to get form identifier based on schemas and context
const getFormId = (schemas: Array<{ name: string }>, preventDefaultSubmit?: boolean): string => {
  if (preventDefaultSubmit)
    return 'credentials'
  if (schemas.some(s => s.name === 'subscription_name')) {
    // For ApiKey modal step 2, basic form only has subscription_name and callback_url
    if (currentModalType === 'apikey' && schemas.length === 2)
      return 'basic'
    // For ManualEditModal and OAuthEditModal, the main form always includes subscription_name
    return 'main'
  }
  return 'parameters'
}

vi.mock('@/app/components/base/form/components/base', () => ({
  BaseForm: vi.fn().mockImplementation(({ formSchemas, ref, preventDefaultSubmit }) => {
    const formId = getFormId(formSchemas || [], preventDefaultSubmit)
    if (ref) {
      ref.current = {
        getFormValues: () => formValuesMap.get(formId) || { values: {}, isCheckValidated: true },
      }
    }
    return (
      <div
        data-testid={`base-form-${formId}`}
        data-schemas-count={formSchemas?.length || 0}
        data-prevent-submit={preventDefaultSubmit}
      >
        {formSchemas?.map((schema: {
          name: string
          type: string
          default?: unknown
          dynamicSelectParams?: unknown
          fieldClassName?: string
          labelClassName?: string
        }) => (
          <div
            key={schema.name}
            data-testid={`form-field-${schema.name}`}
            data-field-type={schema.type}
            data-field-default={String(schema.default || '')}
            data-has-dynamic-select={!!schema.dynamicSelectParams}
            data-field-class={schema.fieldClassName || ''}
            data-label-class={schema.labelClassName || ''}
          >
            {schema.name}
          </div>
        ))}
      </div>
    )
  }),
}))

vi.mock('@/app/components/base/modal/modal', () => ({
  default: ({
    title,
    confirmButtonText,
    onClose,
    onCancel,
    onConfirm,
    disabled,
    children,
    showExtraButton,
    extraButtonText,
    onExtraButtonClick,
    bottomSlot,
  }: {
    title: string
    confirmButtonText: string
    onClose: () => void
    onCancel: () => void
    onConfirm: () => void
    disabled?: boolean
    children: React.ReactNode
    showExtraButton?: boolean
    extraButtonText?: string
    onExtraButtonClick?: () => void
    bottomSlot?: React.ReactNode
  }) => (
    <div data-testid="modal" data-title={title} data-disabled={disabled}>
      <div data-testid="modal-content">{children}</div>
      <button data-testid="modal-confirm-button" onClick={onConfirm} disabled={disabled}>
        {confirmButtonText}
      </button>
      <button data-testid="modal-cancel-button" onClick={onCancel}>Cancel</button>
      <button data-testid="modal-close-button" onClick={onClose}>Close</button>
      {showExtraButton && (
        <button data-testid="modal-extra-button" onClick={onExtraButtonClick}>
          {extraButtonText}
        </button>
      )}
      {!!bottomSlot && <div data-testid="modal-bottom-slot">{bottomSlot}</div>}
    </div>
  ),
}))

// ==================== Test Utilities ====================

const createSubscription = (overrides: Partial<TriggerSubscription> = {}): TriggerSubscription => ({
  id: 'test-subscription-id',
  name: 'Test Subscription',
  provider: 'test-provider',
  credential_type: TriggerCredentialTypeEnum.Unauthorized,
  credentials: {},
  endpoint: 'https://example.com/webhook',
  parameters: {},
  properties: {},
  workflows_in_use: 0,
  ...overrides,
})

const createPluginDetail = (overrides: Partial<PluginDetail> = {}): PluginDetail => ({
  id: 'test-plugin-id',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  name: 'Test Plugin',
  plugin_id: 'test-plugin',
  plugin_unique_identifier: 'test-plugin-unique-id',
  declaration: {
    plugin_unique_identifier: 'test-plugin-unique-id',
    version: '1.0.0',
    author: 'Test Author',
    icon: 'test-icon',
    name: 'test-plugin',
    category: PluginCategoryEnum.trigger,
    label: {} as Record<string, string>,
    description: {} as Record<string, string>,
    created_at: '2024-01-01T00:00:00Z',
    resource: {},
    plugins: [],
    verified: true,
    endpoint: { settings: [], endpoints: [] },
    model: {},
    tags: [],
    agent_strategy: {},
    meta: { version: '1.0.0' },
    trigger: {
      events: [],
      identity: {
        author: 'Test Author',
        name: 'test-trigger',
        label: {} as Record<string, string>,
        description: {} as Record<string, string>,
        icon: 'test-icon',
        tags: [],
      },
      subscription_constructor: {
        credentials_schema: [],
        oauth_schema: { client_schema: [], credentials_schema: [] },
        parameters: [],
      },
      subscription_schema: [],
    },
  },
  installation_id: 'test-installation-id',
  tenant_id: 'test-tenant-id',
  endpoints_setups: 0,
  endpoints_active: 0,
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_unique_identifier: 'test-plugin-unique-id',
  source: PluginSource.marketplace,
  status: 'active' as const,
  deprecated_reason: '',
  alternative_plugin_id: '',
  ...overrides,
})

const createSchemaField = (name: string, type: string = 'string', overrides = {}): SubscriptionSchema => ({
  name,
  label: { en_US: name },
  type,
  required: true,
  multiple: false,
  auto_generate: null,
  template: null,
  scope: null,
  min: null,
  max: null,
  precision: null,
  ...overrides,
})

const createCredentialSchema = (name: string, type: string = 'secret-input', overrides = {}): CredentialSchema => ({
  name,
  label: { en_US: name },
  type,
  required: true,
  ...overrides,
})

const resetMocks = () => {
  mockPluginStoreDetail.plugin_id = 'test-plugin-id'
  mockPluginStoreDetail.provider = 'test-provider'
  mockPluginStoreDetail.declaration.trigger.subscription_schema = []
  mockPluginStoreDetail.declaration.trigger.subscription_constructor.credentials_schema = []
  mockPluginStoreDetail.declaration.trigger.subscription_constructor.parameters = []
  formValuesMap.clear()
  // Set default form values
  formValuesMap.set('main', { values: { subscription_name: 'Test' }, isCheckValidated: true })
  formValuesMap.set('basic', { values: { subscription_name: 'Test' }, isCheckValidated: true })
  formValuesMap.set('credentials', { values: {}, isCheckValidated: true })
  formValuesMap.set('parameters', { values: {}, isCheckValidated: true })
  // Reset pending states
  mockIsUpdating = false
  mockIsVerifying = false
}

// ==================== Tests ====================

describe('Edit Modal Components', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMocks()
  })

  // ==================== EditModal (Router) Tests ====================

  describe('EditModal (Router)', () => {
    it.each([
      { type: TriggerCredentialTypeEnum.Unauthorized, name: 'ManualEditModal' },
      { type: TriggerCredentialTypeEnum.Oauth2, name: 'OAuthEditModal' },
      { type: TriggerCredentialTypeEnum.ApiKey, name: 'ApiKeyEditModal' },
    ])('should render $name for $type credential type', ({ type }) => {
      render(<EditModal onClose={vi.fn()} subscription={createSubscription({ credential_type: type })} />)
      expect(screen.getByTestId('modal')).toBeInTheDocument()
    })

    it('should render nothing for unknown credential type', () => {
      const { container } = render(
        <EditModal onClose={vi.fn()} subscription={createSubscription({ credential_type: 'unknown' as TriggerCredentialTypeEnum })} />,
      )
      expect(container).toBeEmptyDOMElement()
    })

    it('should pass pluginDetail to child modal', () => {
      const pluginDetail = createPluginDetail({ id: 'custom-plugin' })
      render(
        <EditModal
          onClose={vi.fn()}
          subscription={createSubscription()}
          pluginDetail={pluginDetail}
        />,
      )
      expect(screen.getByTestId('readme-entrance')).toHaveAttribute('data-plugin-id', 'custom-plugin')
    })
  })

  // ==================== ManualEditModal Tests ====================

  describe('ManualEditModal', () => {
    beforeEach(() => {
      currentModalType = 'manual'
    })

    const createProps = (overrides = {}) => ({
      onClose: vi.fn(),
      subscription: createSubscription(),
      ...overrides,
    })

    describe('Rendering', () => {
      it('should render modal with correct title', () => {
        render(<ManualEditModal {...createProps()} />)
        expect(screen.getByTestId('modal')).toHaveAttribute(
          'data-title',
          'pluginTrigger.subscription.list.item.actions.edit.title',
        )
      })

      it('should render ReadmeEntrance when pluginDetail is provided', () => {
        render(<ManualEditModal {...createProps({ pluginDetail: createPluginDetail() })} />)
        expect(screen.getByTestId('readme-entrance')).toBeInTheDocument()
      })

      it('should not render ReadmeEntrance when pluginDetail is not provided', () => {
        render(<ManualEditModal {...createProps()} />)
        expect(screen.queryByTestId('readme-entrance')).not.toBeInTheDocument()
      })

      it('should render subscription_name and callback_url fields', () => {
        render(<ManualEditModal {...createProps()} />)
        expect(screen.getByTestId('form-field-subscription_name')).toBeInTheDocument()
        expect(screen.getByTestId('form-field-callback_url')).toBeInTheDocument()
      })

      it('should render properties schema fields from store', () => {
        mockPluginStoreDetail.declaration.trigger.subscription_schema = [
          createSchemaField('custom_field'),
          createSchemaField('another_field', 'number'),
        ]
        render(<ManualEditModal {...createProps()} />)
        expect(screen.getByTestId('form-field-custom_field')).toBeInTheDocument()
        expect(screen.getByTestId('form-field-another_field')).toBeInTheDocument()
      })
    })

    describe('Form Schema Default Values', () => {
      it('should use subscription name as default', () => {
        render(<ManualEditModal {...createProps({ subscription: createSubscription({ name: 'My Sub' }) })} />)
        expect(screen.getByTestId('form-field-subscription_name')).toHaveAttribute('data-field-default', 'My Sub')
      })

      it('should use endpoint as callback_url default', () => {
        render(<ManualEditModal {...createProps({ subscription: createSubscription({ endpoint: 'https://test.com' }) })} />)
        expect(screen.getByTestId('form-field-callback_url')).toHaveAttribute('data-field-default', 'https://test.com')
      })

      it('should use empty string when endpoint is empty', () => {
        render(<ManualEditModal {...createProps({ subscription: createSubscription({ endpoint: '' }) })} />)
        expect(screen.getByTestId('form-field-callback_url')).toHaveAttribute('data-field-default', '')
      })

      it('should use subscription properties as defaults for custom fields', () => {
        mockPluginStoreDetail.declaration.trigger.subscription_schema = [createSchemaField('custom')]
        render(<ManualEditModal {...createProps({ subscription: createSubscription({ properties: { custom: 'value' } }) })} />)
        expect(screen.getByTestId('form-field-custom')).toHaveAttribute('data-field-default', 'value')
      })

      it('should use schema default when subscription property is missing', () => {
        mockPluginStoreDetail.declaration.trigger.subscription_schema = [
          createSchemaField('custom', 'string', { default: 'schema_default' }),
        ]
        render(<ManualEditModal {...createProps()} />)
        expect(screen.getByTestId('form-field-custom')).toHaveAttribute('data-field-default', 'schema_default')
      })
    })

    describe('Confirm Button Text', () => {
      it('should show "save" when not updating', () => {
        render(<ManualEditModal {...createProps()} />)
        expect(screen.getByTestId('modal-confirm-button')).toHaveTextContent('common.operation.save')
      })
    })

    describe('User Interactions', () => {
      it('should call onClose when cancel button is clicked', () => {
        const onClose = vi.fn()
        render(<ManualEditModal {...createProps({ onClose })} />)
        fireEvent.click(screen.getByTestId('modal-cancel-button'))
        expect(onClose).toHaveBeenCalledTimes(1)
      })

      it('should call onClose when close button is clicked', () => {
        const onClose = vi.fn()
        render(<ManualEditModal {...createProps({ onClose })} />)
        fireEvent.click(screen.getByTestId('modal-close-button'))
        expect(onClose).toHaveBeenCalledTimes(1)
      })

      it('should call updateSubscription when confirm is clicked with valid form', () => {
        formValuesMap.set('main', { values: { subscription_name: 'New Name' }, isCheckValidated: true })
        render(<ManualEditModal {...createProps()} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        expect(mockUpdateSubscription).toHaveBeenCalledWith(
          expect.objectContaining({ subscriptionId: 'test-subscription-id', name: 'New Name' }),
          expect.any(Object),
        )
      })

      it('should not call updateSubscription when form validation fails', () => {
        formValuesMap.set('main', { values: {}, isCheckValidated: false })
        render(<ManualEditModal {...createProps()} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        expect(mockUpdateSubscription).not.toHaveBeenCalled()
      })
    })

    describe('Properties Change Detection', () => {
      it('should not send properties when unchanged', () => {
        const subscription = createSubscription({ properties: { custom: 'value' } })
        formValuesMap.set('main', {
          values: { subscription_name: 'Name', callback_url: '', custom: 'value' },
          isCheckValidated: true,
        })
        render(<ManualEditModal {...createProps({ subscription })} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        expect(mockUpdateSubscription).toHaveBeenCalledWith(
          expect.objectContaining({ properties: undefined }),
          expect.any(Object),
        )
      })

      it('should send properties when changed', () => {
        const subscription = createSubscription({ properties: { custom: 'old' } })
        formValuesMap.set('main', {
          values: { subscription_name: 'Name', callback_url: '', custom: 'new' },
          isCheckValidated: true,
        })
        render(<ManualEditModal {...createProps({ subscription })} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        expect(mockUpdateSubscription).toHaveBeenCalledWith(
          expect.objectContaining({ properties: { custom: 'new' } }),
          expect.any(Object),
        )
      })
    })

    describe('Update Callbacks', () => {
      it('should show success toast and call onClose on success', async () => {
        formValuesMap.set('main', { values: { subscription_name: 'Name' }, isCheckValidated: true })
        mockUpdateSubscription.mockImplementation((_p, cb) => cb.onSuccess())
        const onClose = vi.fn()
        render(<ManualEditModal {...createProps({ onClose })} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }))
        })
        expect(mockRefetch).toHaveBeenCalled()
        expect(onClose).toHaveBeenCalled()
      })

      it('should show error toast with Error message on failure', async () => {
        formValuesMap.set('main', { values: { subscription_name: 'Name' }, isCheckValidated: true })
        mockUpdateSubscription.mockImplementation((_p, cb) => cb.onError(new Error('Custom error')))
        render(<ManualEditModal {...createProps()} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({
            type: 'error',
            message: 'Custom error',
          }))
        })
      })

      it('should use error.message from object when available', async () => {
        formValuesMap.set('main', { values: { subscription_name: 'Name' }, isCheckValidated: true })
        mockUpdateSubscription.mockImplementation((_p, cb) => cb.onError({ message: 'Object error' }))
        render(<ManualEditModal {...createProps()} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({
            type: 'error',
            message: 'Object error',
          }))
        })
      })

      it('should use fallback message when error has no message', async () => {
        formValuesMap.set('main', { values: { subscription_name: 'Name' }, isCheckValidated: true })
        mockUpdateSubscription.mockImplementation((_p, cb) => cb.onError({}))
        render(<ManualEditModal {...createProps()} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({
            type: 'error',
            message: 'pluginTrigger.subscription.list.item.actions.edit.error',
          }))
        })
      })

      it('should use fallback message when error is null', async () => {
        formValuesMap.set('main', { values: { subscription_name: 'Name' }, isCheckValidated: true })
        mockUpdateSubscription.mockImplementation((_p, cb) => cb.onError(null))
        render(<ManualEditModal {...createProps()} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({
            type: 'error',
            message: 'pluginTrigger.subscription.list.item.actions.edit.error',
          }))
        })
      })

      it('should use fallback when error.message is not a string', async () => {
        formValuesMap.set('main', { values: { subscription_name: 'Name' }, isCheckValidated: true })
        mockUpdateSubscription.mockImplementation((_p, cb) => cb.onError({ message: 123 }))
        render(<ManualEditModal {...createProps()} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({
            type: 'error',
            message: 'pluginTrigger.subscription.list.item.actions.edit.error',
          }))
        })
      })

      it('should use fallback when error.message is empty string', async () => {
        formValuesMap.set('main', { values: { subscription_name: 'Name' }, isCheckValidated: true })
        mockUpdateSubscription.mockImplementation((_p, cb) => cb.onError({ message: '' }))
        render(<ManualEditModal {...createProps()} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({
            type: 'error',
            message: 'pluginTrigger.subscription.list.item.actions.edit.error',
          }))
        })
      })
    })

    describe('normalizeFormType in ManualEditModal', () => {
      it('should normalize number type', () => {
        mockPluginStoreDetail.declaration.trigger.subscription_schema = [
          createSchemaField('num_field', 'number'),
        ]
        render(<ManualEditModal {...createProps()} />)
        expect(screen.getByTestId('form-field-num_field')).toHaveAttribute('data-field-type', FormTypeEnum.textNumber)
      })

      it('should normalize select type', () => {
        mockPluginStoreDetail.declaration.trigger.subscription_schema = [
          createSchemaField('sel_field', 'select'),
        ]
        render(<ManualEditModal {...createProps()} />)
        expect(screen.getByTestId('form-field-sel_field')).toHaveAttribute('data-field-type', FormTypeEnum.select)
      })

      it('should return textInput for unknown type', () => {
        mockPluginStoreDetail.declaration.trigger.subscription_schema = [
          createSchemaField('unknown_field', 'unknown-custom-type'),
        ]
        render(<ManualEditModal {...createProps()} />)
        expect(screen.getByTestId('form-field-unknown_field')).toHaveAttribute('data-field-type', FormTypeEnum.textInput)
      })
    })

    describe('Button Text State', () => {
      it('should show saving text when isUpdating is true', () => {
        mockIsUpdating = true
        render(<ManualEditModal {...createProps()} />)
        expect(screen.getByTestId('modal-confirm-button')).toHaveTextContent('common.operation.saving')
      })
    })
  })

  // ==================== OAuthEditModal Tests ====================

  describe('OAuthEditModal', () => {
    beforeEach(() => {
      currentModalType = 'oauth'
    })

    const createProps = (overrides = {}) => ({
      onClose: vi.fn(),
      subscription: createSubscription({ credential_type: TriggerCredentialTypeEnum.Oauth2 }),
      ...overrides,
    })

    describe('Rendering', () => {
      it('should render modal with correct title', () => {
        render(<OAuthEditModal {...createProps()} />)
        expect(screen.getByTestId('modal')).toHaveAttribute(
          'data-title',
          'pluginTrigger.subscription.list.item.actions.edit.title',
        )
      })

      it('should render ReadmeEntrance when pluginDetail is provided', () => {
        render(<OAuthEditModal {...createProps({ pluginDetail: createPluginDetail() })} />)
        expect(screen.getByTestId('readme-entrance')).toBeInTheDocument()
      })

      it('should render parameters schema fields from store', () => {
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.parameters = [
          createSchemaField('oauth_param'),
        ]
        render(<OAuthEditModal {...createProps()} />)
        expect(screen.getByTestId('form-field-oauth_param')).toBeInTheDocument()
      })
    })

    describe('Form Schema Default Values', () => {
      it('should use subscription parameters as defaults', () => {
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.parameters = [
          createSchemaField('channel'),
        ]
        render(
          <OAuthEditModal {...createProps({
            subscription: createSubscription({
              credential_type: TriggerCredentialTypeEnum.Oauth2,
              parameters: { channel: 'general' },
            }),
          })}
          />,
        )
        expect(screen.getByTestId('form-field-channel')).toHaveAttribute('data-field-default', 'general')
      })
    })

    describe('Dynamic Select Support', () => {
      it('should add dynamicSelectParams for dynamic-select type fields', () => {
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.parameters = [
          createSchemaField('dynamic_field', FormTypeEnum.dynamicSelect),
        ]
        render(<OAuthEditModal {...createProps()} />)
        expect(screen.getByTestId('form-field-dynamic_field')).toHaveAttribute('data-has-dynamic-select', 'true')
      })

      it('should not add dynamicSelectParams for non-dynamic-select fields', () => {
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.parameters = [
          createSchemaField('text_field', 'string'),
        ]
        render(<OAuthEditModal {...createProps()} />)
        expect(screen.getByTestId('form-field-text_field')).toHaveAttribute('data-has-dynamic-select', 'false')
      })
    })

    describe('Boolean Field Styling', () => {
      it('should add fieldClassName and labelClassName for boolean type', () => {
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.parameters = [
          createSchemaField('bool_field', FormTypeEnum.boolean),
        ]
        render(<OAuthEditModal {...createProps()} />)
        expect(screen.getByTestId('form-field-bool_field')).toHaveAttribute(
          'data-field-class',
          'flex items-center justify-between',
        )
        expect(screen.getByTestId('form-field-bool_field')).toHaveAttribute('data-label-class', 'mb-0')
      })
    })

    describe('Parameters Change Detection', () => {
      it('should not send parameters when unchanged', () => {
        formValuesMap.set('main', {
          values: { subscription_name: 'Name', callback_url: '', channel: 'general' },
          isCheckValidated: true,
        })
        render(
          <OAuthEditModal {...createProps({
            subscription: createSubscription({
              credential_type: TriggerCredentialTypeEnum.Oauth2,
              parameters: { channel: 'general' },
            }),
          })}
          />,
        )
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        expect(mockUpdateSubscription).toHaveBeenCalledWith(
          expect.objectContaining({ parameters: undefined }),
          expect.any(Object),
        )
      })

      it('should send parameters when changed', () => {
        formValuesMap.set('main', {
          values: { subscription_name: 'Name', callback_url: '', channel: 'new' },
          isCheckValidated: true,
        })
        render(
          <OAuthEditModal {...createProps({
            subscription: createSubscription({
              credential_type: TriggerCredentialTypeEnum.Oauth2,
              parameters: { channel: 'old' },
            }),
          })}
          />,
        )
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        expect(mockUpdateSubscription).toHaveBeenCalledWith(
          expect.objectContaining({ parameters: { channel: 'new' } }),
          expect.any(Object),
        )
      })
    })

    describe('Update Callbacks', () => {
      it('should show success toast and call onClose on success', async () => {
        formValuesMap.set('main', { values: { subscription_name: 'Name' }, isCheckValidated: true })
        mockUpdateSubscription.mockImplementation((_p, cb) => cb.onSuccess())
        const onClose = vi.fn()
        render(<OAuthEditModal {...createProps({ onClose })} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }))
        })
        expect(onClose).toHaveBeenCalled()
      })

      it('should show error toast on failure', async () => {
        formValuesMap.set('main', { values: { subscription_name: 'Name' }, isCheckValidated: true })
        mockUpdateSubscription.mockImplementation((_p, cb) => cb.onError(new Error('Failed')))
        render(<OAuthEditModal {...createProps()} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
        })
      })

      it('should use fallback when error.message is not a string', async () => {
        formValuesMap.set('main', { values: { subscription_name: 'Name' }, isCheckValidated: true })
        mockUpdateSubscription.mockImplementation((_p, cb) => cb.onError({ message: 123 }))
        render(<OAuthEditModal {...createProps()} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({
            type: 'error',
            message: 'pluginTrigger.subscription.list.item.actions.edit.error',
          }))
        })
      })

      it('should use fallback when error.message is empty string', async () => {
        formValuesMap.set('main', { values: { subscription_name: 'Name' }, isCheckValidated: true })
        mockUpdateSubscription.mockImplementation((_p, cb) => cb.onError({ message: '' }))
        render(<OAuthEditModal {...createProps()} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({
            type: 'error',
            message: 'pluginTrigger.subscription.list.item.actions.edit.error',
          }))
        })
      })
    })

    describe('Form Validation', () => {
      it('should not call updateSubscription when form validation fails', () => {
        formValuesMap.set('main', { values: {}, isCheckValidated: false })
        render(<OAuthEditModal {...createProps()} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        expect(mockUpdateSubscription).not.toHaveBeenCalled()
      })
    })

    describe('normalizeFormType in OAuthEditModal', () => {
      it('should normalize number type', () => {
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.parameters = [
          createSchemaField('num_field', 'number'),
        ]
        render(<OAuthEditModal {...createProps()} />)
        expect(screen.getByTestId('form-field-num_field')).toHaveAttribute('data-field-type', FormTypeEnum.textNumber)
      })

      it('should normalize integer type', () => {
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.parameters = [
          createSchemaField('int_field', 'integer'),
        ]
        render(<OAuthEditModal {...createProps()} />)
        expect(screen.getByTestId('form-field-int_field')).toHaveAttribute('data-field-type', FormTypeEnum.textNumber)
      })

      it('should normalize select type', () => {
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.parameters = [
          createSchemaField('sel_field', 'select'),
        ]
        render(<OAuthEditModal {...createProps()} />)
        expect(screen.getByTestId('form-field-sel_field')).toHaveAttribute('data-field-type', FormTypeEnum.select)
      })

      it('should normalize password type', () => {
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.parameters = [
          createSchemaField('pwd_field', 'password'),
        ]
        render(<OAuthEditModal {...createProps()} />)
        expect(screen.getByTestId('form-field-pwd_field')).toHaveAttribute('data-field-type', FormTypeEnum.secretInput)
      })

      it('should return textInput for unknown type', () => {
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.parameters = [
          createSchemaField('unknown_field', 'custom-unknown-type'),
        ]
        render(<OAuthEditModal {...createProps()} />)
        expect(screen.getByTestId('form-field-unknown_field')).toHaveAttribute('data-field-type', FormTypeEnum.textInput)
      })
    })

    describe('Button Text State', () => {
      it('should show saving text when isUpdating is true', () => {
        mockIsUpdating = true
        render(<OAuthEditModal {...createProps()} />)
        expect(screen.getByTestId('modal-confirm-button')).toHaveTextContent('common.operation.saving')
      })
    })
  })

  // ==================== ApiKeyEditModal Tests ====================

  describe('ApiKeyEditModal', () => {
    beforeEach(() => {
      currentModalType = 'apikey'
    })

    const createProps = (overrides = {}) => ({
      onClose: vi.fn(),
      subscription: createSubscription({ credential_type: TriggerCredentialTypeEnum.ApiKey }),
      ...overrides,
    })

    // Setup credentials schema for ApiKeyEditModal tests
    const setupCredentialsSchema = () => {
      mockPluginStoreDetail.declaration.trigger.subscription_constructor.credentials_schema = [
        createCredentialSchema('api_key'),
      ]
    }

    describe('Rendering - Step 1 (Credentials)', () => {
      it('should render modal with correct title', () => {
        render(<ApiKeyEditModal {...createProps()} />)
        expect(screen.getByTestId('modal')).toHaveAttribute(
          'data-title',
          'pluginTrigger.subscription.list.item.actions.edit.title',
        )
      })

      it('should render EncryptedBottom in credentials step', () => {
        render(<ApiKeyEditModal {...createProps()} />)
        expect(screen.getByTestId('modal-bottom-slot')).toBeInTheDocument()
        expect(screen.getByTestId('encrypted-bottom')).toBeInTheDocument()
      })

      it('should render credentials form fields', () => {
        setupCredentialsSchema()
        render(<ApiKeyEditModal {...createProps()} />)
        expect(screen.getByTestId('form-field-api_key')).toBeInTheDocument()
      })

      it('should show verify button text in credentials step', () => {
        render(<ApiKeyEditModal {...createProps()} />)
        expect(screen.getByTestId('modal-confirm-button')).toHaveTextContent('pluginTrigger.modal.common.verify')
      })

      it('should not show extra button (back) in credentials step', () => {
        render(<ApiKeyEditModal {...createProps()} />)
        expect(screen.queryByTestId('modal-extra-button')).not.toBeInTheDocument()
      })

      it('should render ReadmeEntrance when pluginDetail is provided', () => {
        render(<ApiKeyEditModal {...createProps({ pluginDetail: createPluginDetail() })} />)
        expect(screen.getByTestId('readme-entrance')).toBeInTheDocument()
      })
    })

    describe('Credentials Form Defaults', () => {
      it('should use subscription credentials as defaults', () => {
        setupCredentialsSchema()
        render(
          <ApiKeyEditModal {...createProps({
            subscription: createSubscription({
              credential_type: TriggerCredentialTypeEnum.ApiKey,
              credentials: { api_key: '[__HIDDEN__]' },
            }),
          })}
          />,
        )
        expect(screen.getByTestId('form-field-api_key')).toHaveAttribute('data-field-default', '[__HIDDEN__]')
      })
    })

    describe('Credential Verification', () => {
      beforeEach(() => {
        setupCredentialsSchema()
      })

      it('should call verifyCredentials when confirm clicked in credentials step', () => {
        formValuesMap.set('credentials', { values: { api_key: 'test-key' }, isCheckValidated: true })
        render(<ApiKeyEditModal {...createProps()} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        expect(mockVerifyCredentials).toHaveBeenCalledWith(
          expect.objectContaining({
            provider: 'test-provider',
            subscriptionId: 'test-subscription-id',
            credentials: { api_key: 'test-key' },
          }),
          expect.any(Object),
        )
      })

      it('should not call verifyCredentials when form validation fails', () => {
        formValuesMap.set('credentials', { values: {}, isCheckValidated: false })
        render(<ApiKeyEditModal {...createProps()} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        expect(mockVerifyCredentials).not.toHaveBeenCalled()
      })

      it('should show success toast and move to step 2 on successful verification', async () => {
        formValuesMap.set('credentials', { values: { api_key: 'new-key' }, isCheckValidated: true })
        mockVerifyCredentials.mockImplementation((_p, cb) => cb.onSuccess())
        render(<ApiKeyEditModal {...createProps()} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({
            type: 'success',
            message: 'pluginTrigger.modal.apiKey.verify.success',
          }))
        })
        // Should now be in step 2
        expect(screen.getByTestId('modal-confirm-button')).toHaveTextContent('common.operation.save')
      })

      it('should show error toast on verification failure', async () => {
        formValuesMap.set('credentials', { values: { api_key: 'bad-key' }, isCheckValidated: true })
        mockParsePluginErrorMessage.mockResolvedValue('Invalid API key')
        mockVerifyCredentials.mockImplementation((_p, cb) => cb.onError(new Error('Invalid')))
        render(<ApiKeyEditModal {...createProps()} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({
            type: 'error',
            message: 'Invalid API key',
          }))
        })
      })

      it('should use fallback error message when parsePluginErrorMessage returns null', async () => {
        formValuesMap.set('credentials', { values: { api_key: 'bad-key' }, isCheckValidated: true })
        mockParsePluginErrorMessage.mockResolvedValue(null)
        mockVerifyCredentials.mockImplementation((_p, cb) => cb.onError(new Error('Invalid')))
        render(<ApiKeyEditModal {...createProps()} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({
            type: 'error',
            message: 'pluginTrigger.modal.apiKey.verify.error',
          }))
        })
      })

      it('should set verifiedCredentials to null when all credentials are hidden', async () => {
        formValuesMap.set('credentials', { values: { api_key: '[__HIDDEN__]' }, isCheckValidated: true })
        formValuesMap.set('basic', { values: { subscription_name: 'Name' }, isCheckValidated: true })
        mockVerifyCredentials.mockImplementation((_p, cb) => cb.onSuccess())
        render(<ApiKeyEditModal {...createProps()} />)

        // Verify credentials
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(screen.getByTestId('modal-confirm-button')).toHaveTextContent('common.operation.save')
        })

        // Update subscription
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        expect(mockUpdateSubscription).toHaveBeenCalledWith(
          expect.objectContaining({ credentials: undefined }),
          expect.any(Object),
        )
      })
    })

    describe('Step 2 (Configuration)', () => {
      beforeEach(() => {
        setupCredentialsSchema()
        formValuesMap.set('credentials', { values: { api_key: 'new-key' }, isCheckValidated: true })
        mockVerifyCredentials.mockImplementation((_p, cb) => cb.onSuccess())
      })

      it('should show save button text in configuration step', async () => {
        render(<ApiKeyEditModal {...createProps()} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(screen.getByTestId('modal-confirm-button')).toHaveTextContent('common.operation.save')
        })
      })

      it('should show extra button (back) in configuration step', async () => {
        render(<ApiKeyEditModal {...createProps()} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(screen.getByTestId('modal-extra-button')).toBeInTheDocument()
          expect(screen.getByTestId('modal-extra-button')).toHaveTextContent('pluginTrigger.modal.common.back')
        })
      })

      it('should not show EncryptedBottom in configuration step', async () => {
        render(<ApiKeyEditModal {...createProps()} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(screen.queryByTestId('modal-bottom-slot')).not.toBeInTheDocument()
        })
      })

      it('should render basic form fields in step 2', async () => {
        render(<ApiKeyEditModal {...createProps()} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(screen.getByTestId('form-field-subscription_name')).toBeInTheDocument()
          expect(screen.getByTestId('form-field-callback_url')).toBeInTheDocument()
        })
      })

      it('should render parameters form when parameters schema exists', async () => {
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.parameters = [
          createSchemaField('param1'),
        ]
        render(<ApiKeyEditModal {...createProps()} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(screen.getByTestId('form-field-param1')).toBeInTheDocument()
        })
      })
    })

    describe('Back Button', () => {
      beforeEach(() => {
        setupCredentialsSchema()
      })

      it('should go back to credentials step when back button is clicked', async () => {
        formValuesMap.set('credentials', { values: { api_key: 'new-key' }, isCheckValidated: true })
        mockVerifyCredentials.mockImplementation((_p, cb) => cb.onSuccess())
        render(<ApiKeyEditModal {...createProps()} />)

        // Go to step 2
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(screen.getByTestId('modal-extra-button')).toBeInTheDocument()
        })

        // Click back
        fireEvent.click(screen.getByTestId('modal-extra-button'))

        // Should be back in step 1
        await waitFor(() => {
          expect(screen.getByTestId('modal-confirm-button')).toHaveTextContent('pluginTrigger.modal.common.verify')
        })
        expect(screen.queryByTestId('modal-extra-button')).not.toBeInTheDocument()
      })

      it('should go back to credentials step when clicking step indicator', async () => {
        formValuesMap.set('credentials', { values: { api_key: 'new-key' }, isCheckValidated: true })
        mockVerifyCredentials.mockImplementation((_p, cb) => cb.onSuccess())
        render(<ApiKeyEditModal {...createProps()} />)

        // Go to step 2
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(screen.getByTestId('modal-confirm-button')).toHaveTextContent('common.operation.save')
        })

        // Find and click the step indicator (first step text should be clickable in step 2)
        const stepIndicator = screen.getByText('pluginTrigger.modal.steps.verify')
        fireEvent.click(stepIndicator)

        // Should be back in step 1
        await waitFor(() => {
          expect(screen.getByTestId('modal-confirm-button')).toHaveTextContent('pluginTrigger.modal.common.verify')
        })
      })
    })

    describe('Update Subscription', () => {
      beforeEach(() => {
        setupCredentialsSchema()
        formValuesMap.set('credentials', { values: { api_key: 'new-key' }, isCheckValidated: true })
        mockVerifyCredentials.mockImplementation((_p, cb) => cb.onSuccess())
      })

      it('should call updateSubscription with verified credentials', async () => {
        formValuesMap.set('basic', { values: { subscription_name: 'Name' }, isCheckValidated: true })
        render(<ApiKeyEditModal {...createProps()} />)

        // Step 1: Verify
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(screen.getByTestId('modal-confirm-button')).toHaveTextContent('common.operation.save')
        })

        // Step 2: Update
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        expect(mockUpdateSubscription).toHaveBeenCalledWith(
          expect.objectContaining({
            subscriptionId: 'test-subscription-id',
            name: 'Name',
            credentials: { api_key: 'new-key' },
          }),
          expect.any(Object),
        )
      })

      it('should not call updateSubscription when basic form validation fails', async () => {
        formValuesMap.set('basic', { values: {}, isCheckValidated: false })
        render(<ApiKeyEditModal {...createProps()} />)

        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(screen.getByTestId('modal-confirm-button')).toHaveTextContent('common.operation.save')
        })

        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        expect(mockUpdateSubscription).not.toHaveBeenCalled()
      })

      it('should show success toast and close on successful update', async () => {
        formValuesMap.set('basic', { values: { subscription_name: 'Name' }, isCheckValidated: true })
        mockUpdateSubscription.mockImplementation((_p, cb) => cb.onSuccess())
        const onClose = vi.fn()
        render(<ApiKeyEditModal {...createProps({ onClose })} />)

        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(screen.getByTestId('modal-confirm-button')).toHaveTextContent('common.operation.save')
        })

        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({
            type: 'success',
            message: 'pluginTrigger.subscription.list.item.actions.edit.success',
          }))
        })
        expect(mockRefetch).toHaveBeenCalled()
        expect(onClose).toHaveBeenCalled()
      })

      it('should show error toast on update failure', async () => {
        formValuesMap.set('basic', { values: { subscription_name: 'Name' }, isCheckValidated: true })
        mockParsePluginErrorMessage.mockResolvedValue('Update failed')
        mockUpdateSubscription.mockImplementation((_p, cb) => cb.onError(new Error('Failed')))
        render(<ApiKeyEditModal {...createProps()} />)

        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(screen.getByTestId('modal-confirm-button')).toHaveTextContent('common.operation.save')
        })

        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({
            type: 'error',
            message: 'Update failed',
          }))
        })
      })
    })

    describe('Parameters Change Detection', () => {
      beforeEach(() => {
        setupCredentialsSchema()
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.parameters = [
          createSchemaField('param1'),
        ]
        formValuesMap.set('credentials', { values: { api_key: 'new-key' }, isCheckValidated: true })
        mockVerifyCredentials.mockImplementation((_p, cb) => cb.onSuccess())
      })

      it('should not send parameters when unchanged', async () => {
        formValuesMap.set('basic', { values: { subscription_name: 'Name' }, isCheckValidated: true })
        formValuesMap.set('parameters', { values: { param1: 'value' }, isCheckValidated: true })
        render(
          <ApiKeyEditModal {...createProps({
            subscription: createSubscription({
              credential_type: TriggerCredentialTypeEnum.ApiKey,
              parameters: { param1: 'value' },
            }),
          })}
          />,
        )

        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(screen.getByTestId('modal-confirm-button')).toHaveTextContent('common.operation.save')
        })

        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        expect(mockUpdateSubscription).toHaveBeenCalledWith(
          expect.objectContaining({ parameters: undefined }),
          expect.any(Object),
        )
      })

      it('should send parameters when changed', async () => {
        formValuesMap.set('basic', { values: { subscription_name: 'Name' }, isCheckValidated: true })
        formValuesMap.set('parameters', { values: { param1: 'new_value' }, isCheckValidated: true })
        render(
          <ApiKeyEditModal {...createProps({
            subscription: createSubscription({
              credential_type: TriggerCredentialTypeEnum.ApiKey,
              parameters: { param1: 'old_value' },
            }),
          })}
          />,
        )

        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(screen.getByTestId('modal-confirm-button')).toHaveTextContent('common.operation.save')
        })

        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        expect(mockUpdateSubscription).toHaveBeenCalledWith(
          expect.objectContaining({ parameters: { param1: 'new_value' } }),
          expect.any(Object),
        )
      })
    })

    describe('normalizeFormType in ApiKeyEditModal', () => {
      it('should normalize number type for credentials schema', () => {
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.credentials_schema = [
          createCredentialSchema('port', 'number'),
        ]
        render(<ApiKeyEditModal {...createProps()} />)
        expect(screen.getByTestId('form-field-port')).toHaveAttribute('data-field-type', FormTypeEnum.textNumber)
      })

      it('should normalize select type for credentials schema', () => {
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.credentials_schema = [
          createCredentialSchema('region', 'select'),
        ]
        render(<ApiKeyEditModal {...createProps()} />)
        expect(screen.getByTestId('form-field-region')).toHaveAttribute('data-field-type', FormTypeEnum.select)
      })

      it('should normalize text type for credentials schema', () => {
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.credentials_schema = [
          createCredentialSchema('name', 'text'),
        ]
        render(<ApiKeyEditModal {...createProps()} />)
        expect(screen.getByTestId('form-field-name')).toHaveAttribute('data-field-type', FormTypeEnum.textInput)
      })
    })

    describe('Dynamic Select in Parameters', () => {
      beforeEach(() => {
        setupCredentialsSchema()
        formValuesMap.set('credentials', { values: { api_key: 'key' }, isCheckValidated: true })
        mockVerifyCredentials.mockImplementation((_p, cb) => cb.onSuccess())
      })

      it('should include dynamicSelectParams for dynamic-select type parameters', async () => {
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.parameters = [
          createSchemaField('channel', FormTypeEnum.dynamicSelect),
        ]
        render(<ApiKeyEditModal {...createProps()} />)

        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(screen.getByTestId('modal-confirm-button')).toHaveTextContent('common.operation.save')
        })

        expect(screen.getByTestId('form-field-channel')).toHaveAttribute('data-has-dynamic-select', 'true')
      })
    })

    describe('Boolean Field Styling', () => {
      beforeEach(() => {
        setupCredentialsSchema()
        formValuesMap.set('credentials', { values: { api_key: 'key' }, isCheckValidated: true })
        mockVerifyCredentials.mockImplementation((_p, cb) => cb.onSuccess())
      })

      it('should add special class for boolean type parameters', async () => {
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.parameters = [
          createSchemaField('enabled', FormTypeEnum.boolean),
        ]
        render(<ApiKeyEditModal {...createProps()} />)

        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(screen.getByTestId('modal-confirm-button')).toHaveTextContent('common.operation.save')
        })

        expect(screen.getByTestId('form-field-enabled')).toHaveAttribute(
          'data-field-class',
          'flex items-center justify-between',
        )
      })
    })

    describe('normalizeFormType in ApiKeyEditModal - Credentials Schema', () => {
      it('should normalize password type for credentials', () => {
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.credentials_schema = [
          createCredentialSchema('secret_key', 'password'),
        ]
        render(<ApiKeyEditModal {...createProps()} />)
        expect(screen.getByTestId('form-field-secret_key')).toHaveAttribute('data-field-type', FormTypeEnum.secretInput)
      })

      it('should normalize secret type for credentials', () => {
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.credentials_schema = [
          createCredentialSchema('api_secret', 'secret'),
        ]
        render(<ApiKeyEditModal {...createProps()} />)
        expect(screen.getByTestId('form-field-api_secret')).toHaveAttribute('data-field-type', FormTypeEnum.secretInput)
      })

      it('should normalize string type for credentials', () => {
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.credentials_schema = [
          createCredentialSchema('username', 'string'),
        ]
        render(<ApiKeyEditModal {...createProps()} />)
        expect(screen.getByTestId('form-field-username')).toHaveAttribute('data-field-type', FormTypeEnum.textInput)
      })

      it('should normalize integer type for credentials', () => {
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.credentials_schema = [
          createCredentialSchema('timeout', 'integer'),
        ]
        render(<ApiKeyEditModal {...createProps()} />)
        expect(screen.getByTestId('form-field-timeout')).toHaveAttribute('data-field-type', FormTypeEnum.textNumber)
      })

      it('should pass through valid FormTypeEnum for credentials', () => {
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.credentials_schema = [
          createCredentialSchema('file_field', FormTypeEnum.files),
        ]
        render(<ApiKeyEditModal {...createProps()} />)
        expect(screen.getByTestId('form-field-file_field')).toHaveAttribute('data-field-type', FormTypeEnum.files)
      })

      it('should default to textInput for unknown credential types', () => {
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.credentials_schema = [
          createCredentialSchema('custom', 'unknown-type'),
        ]
        render(<ApiKeyEditModal {...createProps()} />)
        expect(screen.getByTestId('form-field-custom')).toHaveAttribute('data-field-type', FormTypeEnum.textInput)
      })
    })

    describe('Parameters Form Validation', () => {
      beforeEach(() => {
        setupCredentialsSchema()
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.parameters = [
          createSchemaField('param1'),
        ]
        formValuesMap.set('credentials', { values: { api_key: 'new-key' }, isCheckValidated: true })
        mockVerifyCredentials.mockImplementation((_p, cb) => cb.onSuccess())
      })

      it('should not update when parameters form validation fails', async () => {
        formValuesMap.set('basic', { values: { subscription_name: 'Name' }, isCheckValidated: true })
        formValuesMap.set('parameters', { values: {}, isCheckValidated: false })
        render(<ApiKeyEditModal {...createProps()} />)

        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(screen.getByTestId('modal-confirm-button')).toHaveTextContent('common.operation.save')
        })

        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        expect(mockUpdateSubscription).not.toHaveBeenCalled()
      })
    })

    describe('ApiKeyEditModal without credentials schema', () => {
      it('should not render credentials form when credentials_schema is empty', () => {
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.credentials_schema = []
        render(<ApiKeyEditModal {...createProps()} />)
        // Should still show the modal but no credentials form fields
        expect(screen.getByTestId('modal')).toBeInTheDocument()
      })
    })

    describe('normalizeFormType in Parameters Schema', () => {
      beforeEach(() => {
        setupCredentialsSchema()
        formValuesMap.set('credentials', { values: { api_key: 'key' }, isCheckValidated: true })
        mockVerifyCredentials.mockImplementation((_p, cb) => cb.onSuccess())
      })

      it('should normalize password type for parameters', async () => {
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.parameters = [
          createSchemaField('secret_param', 'password'),
        ]
        render(<ApiKeyEditModal {...createProps()} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(screen.getByTestId('form-field-secret_param')).toHaveAttribute('data-field-type', FormTypeEnum.secretInput)
        })
      })

      it('should normalize secret type for parameters', async () => {
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.parameters = [
          createSchemaField('api_secret', 'secret'),
        ]
        render(<ApiKeyEditModal {...createProps()} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(screen.getByTestId('form-field-api_secret')).toHaveAttribute('data-field-type', FormTypeEnum.secretInput)
        })
      })

      it('should normalize integer type for parameters', async () => {
        mockPluginStoreDetail.declaration.trigger.subscription_constructor.parameters = [
          createSchemaField('count', 'integer'),
        ]
        render(<ApiKeyEditModal {...createProps()} />)
        fireEvent.click(screen.getByTestId('modal-confirm-button'))
        await waitFor(() => {
          expect(screen.getByTestId('form-field-count')).toHaveAttribute('data-field-type', FormTypeEnum.textNumber)
        })
      })
    })
  })

  // ==================== normalizeFormType Tests ====================

  describe('normalizeFormType behavior', () => {
    const testCases = [
      { input: 'string', expected: FormTypeEnum.textInput },
      { input: 'text', expected: FormTypeEnum.textInput },
      { input: 'password', expected: FormTypeEnum.secretInput },
      { input: 'secret', expected: FormTypeEnum.secretInput },
      { input: 'number', expected: FormTypeEnum.textNumber },
      { input: 'integer', expected: FormTypeEnum.textNumber },
      { input: 'boolean', expected: FormTypeEnum.boolean },
      { input: 'select', expected: FormTypeEnum.select },
    ]

    testCases.forEach(({ input, expected }) => {
      it(`should normalize ${input} to ${expected}`, () => {
        mockPluginStoreDetail.declaration.trigger.subscription_schema = [createSchemaField('field', input)]
        render(<ManualEditModal onClose={vi.fn()} subscription={createSubscription()} />)
        expect(screen.getByTestId('form-field-field')).toHaveAttribute('data-field-type', expected)
      })
    })

    it('should return textInput for unknown types', () => {
      mockPluginStoreDetail.declaration.trigger.subscription_schema = [createSchemaField('field', 'unknown')]
      render(<ManualEditModal onClose={vi.fn()} subscription={createSubscription()} />)
      expect(screen.getByTestId('form-field-field')).toHaveAttribute('data-field-type', FormTypeEnum.textInput)
    })

    it('should pass through valid FormTypeEnum values', () => {
      mockPluginStoreDetail.declaration.trigger.subscription_schema = [createSchemaField('field', FormTypeEnum.files)]
      render(<ManualEditModal onClose={vi.fn()} subscription={createSubscription()} />)
      expect(screen.getByTestId('form-field-field')).toHaveAttribute('data-field-type', FormTypeEnum.files)
    })
  })

  // ==================== Edge Cases ====================

  describe('Edge Cases', () => {
    it('should handle empty subscription name', () => {
      render(<ManualEditModal onClose={vi.fn()} subscription={createSubscription({ name: '' })} />)
      expect(screen.getByTestId('form-field-subscription_name')).toHaveAttribute('data-field-default', '')
    })

    it('should handle special characters in subscription data', () => {
      render(<ManualEditModal onClose={vi.fn()} subscription={createSubscription({ name: '<script>alert("xss")</script>' })} />)
      expect(screen.getByTestId('form-field-subscription_name')).toHaveAttribute('data-field-default', '<script>alert("xss")</script>')
    })

    it('should handle Unicode characters', () => {
      render(<ManualEditModal onClose={vi.fn()} subscription={createSubscription({ name: '测试订阅 🚀' })} />)
      expect(screen.getByTestId('form-field-subscription_name')).toHaveAttribute('data-field-default', '测试订阅 🚀')
    })

    it('should handle multiple schema fields', () => {
      mockPluginStoreDetail.declaration.trigger.subscription_schema = [
        createSchemaField('field1', 'string'),
        createSchemaField('field2', 'number'),
        createSchemaField('field3', 'boolean'),
      ]
      render(<ManualEditModal onClose={vi.fn()} subscription={createSubscription()} />)
      expect(screen.getByTestId('form-field-field1')).toBeInTheDocument()
      expect(screen.getByTestId('form-field-field2')).toBeInTheDocument()
      expect(screen.getByTestId('form-field-field3')).toBeInTheDocument()
    })
  })
})
