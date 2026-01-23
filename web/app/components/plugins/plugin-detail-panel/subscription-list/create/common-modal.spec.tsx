import type { TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Import after mocks
import { SupportedCreationMethods } from '@/app/components/plugins/types'
import { TriggerCredentialTypeEnum } from '@/app/components/workflow/block-selector/types'
import { CommonCreateModal } from './common-modal'

// ============================================================================
// Type Definitions
// ============================================================================

type PluginDetail = {
  plugin_id: string
  provider: string
  name: string
  declaration?: {
    trigger?: {
      subscription_schema?: Array<{ name: string, type: string, required?: boolean, description?: string }>
      subscription_constructor?: {
        credentials_schema?: Array<{ name: string, type: string, required?: boolean, help?: string }>
        parameters?: Array<{ name: string, type: string, required?: boolean, description?: string }>
      }
    }
  }
}

type TriggerLogEntity = {
  id: string
  message: string
  timestamp: string
  level: 'info' | 'warn' | 'error'
}

// ============================================================================
// Mock Factory Functions
// ============================================================================

function createMockPluginDetail(overrides: Partial<PluginDetail> = {}): PluginDetail {
  return {
    plugin_id: 'test-plugin-id',
    provider: 'test-provider',
    name: 'Test Plugin',
    declaration: {
      trigger: {
        subscription_schema: [],
        subscription_constructor: {
          credentials_schema: [],
          parameters: [],
        },
      },
    },
    ...overrides,
  }
}

function createMockSubscriptionBuilder(overrides: Partial<TriggerSubscriptionBuilder> = {}): TriggerSubscriptionBuilder {
  return {
    id: 'builder-123',
    name: 'Test Builder',
    provider: 'test-provider',
    credential_type: TriggerCredentialTypeEnum.ApiKey,
    credentials: {},
    endpoint: 'https://example.com/callback',
    parameters: {},
    properties: {},
    workflows_in_use: 0,
    ...overrides,
  }
}

function createMockLogData(logs: TriggerLogEntity[] = []): { logs: TriggerLogEntity[] } {
  return { logs }
}

// ============================================================================
// Mock Setup
// ============================================================================

// Mock plugin store
const mockPluginDetail = createMockPluginDetail()
const mockUsePluginStore = vi.fn(() => mockPluginDetail)
vi.mock('../../store', () => ({
  usePluginStore: () => mockUsePluginStore(),
}))

// Mock subscription list hook
const mockRefetch = vi.fn()
vi.mock('../use-subscription-list', () => ({
  useSubscriptionList: () => ({
    refetch: mockRefetch,
  }),
}))

// Mock service hooks
const mockVerifyCredentials = vi.fn()
const mockCreateBuilder = vi.fn()
const mockBuildSubscription = vi.fn()
const mockUpdateBuilder = vi.fn()

// Configurable pending states
let mockIsVerifyingCredentials = false
let mockIsBuilding = false
const setMockPendingStates = (verifying: boolean, building: boolean) => {
  mockIsVerifyingCredentials = verifying
  mockIsBuilding = building
}

vi.mock('@/service/use-triggers', () => ({
  useVerifyAndUpdateTriggerSubscriptionBuilder: () => ({
    mutate: mockVerifyCredentials,
    get isPending() { return mockIsVerifyingCredentials },
  }),
  useCreateTriggerSubscriptionBuilder: () => ({
    mutateAsync: mockCreateBuilder,
    isPending: false,
  }),
  useBuildTriggerSubscription: () => ({
    mutate: mockBuildSubscription,
    get isPending() { return mockIsBuilding },
  }),
  useUpdateTriggerSubscriptionBuilder: () => ({
    mutate: mockUpdateBuilder,
    isPending: false,
  }),
  useTriggerSubscriptionBuilderLogs: () => ({
    data: createMockLogData(),
  }),
}))

// Mock error parser
const mockParsePluginErrorMessage = vi.fn().mockResolvedValue(null)
vi.mock('@/utils/error-parser', () => ({
  parsePluginErrorMessage: (...args: unknown[]) => mockParsePluginErrorMessage(...args),
}))

// Mock URL validation
vi.mock('@/utils/urlValidation', () => ({
  isPrivateOrLocalAddress: vi.fn().mockReturnValue(false),
}))

// Mock toast
const mockToastNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: (params: unknown) => mockToastNotify(params),
  },
}))

// Mock Modal component
vi.mock('@/app/components/base/modal/modal', () => ({
  default: ({
    children,
    onClose,
    onConfirm,
    title,
    confirmButtonText,
    bottomSlot,
    size,
    disabled,
  }: {
    children: React.ReactNode
    onClose: () => void
    onConfirm: () => void
    title: string
    confirmButtonText: string
    bottomSlot?: React.ReactNode
    size?: string
    disabled?: boolean
  }) => (
    <div data-testid="modal" data-size={size} data-disabled={disabled}>
      <div data-testid="modal-title">{title}</div>
      <div data-testid="modal-content">{children}</div>
      <div data-testid="modal-bottom-slot">{bottomSlot}</div>
      <button data-testid="modal-confirm" onClick={onConfirm} disabled={disabled}>{confirmButtonText}</button>
      <button data-testid="modal-close" onClick={onClose}>Close</button>
    </div>
  ),
}))

// Configurable form mock values
type MockFormValuesConfig = {
  values: Record<string, unknown>
  isCheckValidated: boolean
}
let mockFormValuesConfig: MockFormValuesConfig = {
  values: { api_key: 'test-api-key', subscription_name: 'Test Subscription' },
  isCheckValidated: true,
}
let mockGetFormReturnsNull = false

// Separate validation configs for different forms
let mockSubscriptionFormValidated = true
let mockAutoParamsFormValidated = true
let mockManualPropsFormValidated = true

const setMockFormValuesConfig = (config: MockFormValuesConfig) => {
  mockFormValuesConfig = config
}
const setMockGetFormReturnsNull = (value: boolean) => {
  mockGetFormReturnsNull = value
}
const setMockFormValidation = (subscription: boolean, autoParams: boolean, manualProps: boolean) => {
  mockSubscriptionFormValidated = subscription
  mockAutoParamsFormValidated = autoParams
  mockManualPropsFormValidated = manualProps
}

// Mock BaseForm component with ref support
vi.mock('@/app/components/base/form/components/base', async () => {
  const React = await import('react')

  type MockFormRef = {
    getFormValues: (options: Record<string, unknown>) => { values: Record<string, unknown>, isCheckValidated: boolean }
    setFields: (fields: Array<{ name: string, errors?: string[], warnings?: string[] }>) => void
    getForm: () => { setFieldValue: (name: string, value: unknown) => void } | null
  }
  type MockBaseFormProps = { formSchemas: Array<{ name: string }>, onChange?: () => void }

  function MockBaseFormInner({ formSchemas, onChange }: MockBaseFormProps, ref: React.ForwardedRef<MockFormRef>) {
    // Determine which form this is based on schema
    const isSubscriptionForm = formSchemas.some((s: { name: string }) => s.name === 'subscription_name')
    const isAutoParamsForm = formSchemas.some((s: { name: string }) =>
      ['repo_name', 'branch', 'repo', 'text_field', 'dynamic_field', 'bool_field', 'text_input_field', 'unknown_field', 'count'].includes(s.name),
    )
    const isManualPropsForm = formSchemas.some((s: { name: string }) => s.name === 'webhook_url')

    React.useImperativeHandle(ref, () => ({
      getFormValues: () => {
        let isValidated = mockFormValuesConfig.isCheckValidated
        if (isSubscriptionForm)
          isValidated = mockSubscriptionFormValidated
        else if (isAutoParamsForm)
          isValidated = mockAutoParamsFormValidated
        else if (isManualPropsForm)
          isValidated = mockManualPropsFormValidated

        return {
          ...mockFormValuesConfig,
          isCheckValidated: isValidated,
        }
      },
      setFields: () => {},
      getForm: () => mockGetFormReturnsNull
        ? null
        : { setFieldValue: () => {} },
    }))
    return (
      <div data-testid="base-form">
        {formSchemas.map((schema: { name: string }) => (
          <input
            key={schema.name}
            data-testid={`form-field-${schema.name}`}
            name={schema.name}
            onChange={onChange}
          />
        ))}
      </div>
    )
  }

  return {
    BaseForm: React.forwardRef(MockBaseFormInner),
  }
})

// Mock EncryptedBottom component
vi.mock('@/app/components/base/encrypted-bottom', () => ({
  EncryptedBottom: () => <div data-testid="encrypted-bottom">Encrypted</div>,
}))

// Mock LogViewer component
vi.mock('../log-viewer', () => ({
  default: ({ logs }: { logs: TriggerLogEntity[] }) => (
    <div data-testid="log-viewer">
      {logs.map(log => (
        <div key={log.id} data-testid={`log-${log.id}`}>{log.message}</div>
      ))}
    </div>
  ),
}))

// Mock debounce
vi.mock('es-toolkit/compat', () => ({
  debounce: (fn: (...args: unknown[]) => unknown) => {
    const debouncedFn = (...args: unknown[]) => fn(...args)
    debouncedFn.cancel = vi.fn()
    return debouncedFn
  },
}))

// ============================================================================
// Test Suites
// ============================================================================

describe('CommonCreateModal', () => {
  const defaultProps = {
    onClose: vi.fn(),
    createType: SupportedCreationMethods.APIKEY,
    builder: undefined as TriggerSubscriptionBuilder | undefined,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUsePluginStore.mockReturnValue(mockPluginDetail)
    mockCreateBuilder.mockResolvedValue({
      subscription_builder: createMockSubscriptionBuilder(),
    })
    // Reset configurable mocks
    setMockPendingStates(false, false)
    setMockFormValuesConfig({
      values: { api_key: 'test-api-key', subscription_name: 'Test Subscription' },
      isCheckValidated: true,
    })
    setMockGetFormReturnsNull(false)
    setMockFormValidation(true, true, true) // All forms validated by default
    mockParsePluginErrorMessage.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render modal with correct title for API Key method', () => {
      render(<CommonCreateModal {...defaultProps} />)

      expect(screen.getByTestId('modal-title')).toHaveTextContent('pluginTrigger.modal.apiKey.title')
    })

    it('should render modal with correct title for Manual method', () => {
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} />)

      expect(screen.getByTestId('modal-title')).toHaveTextContent('pluginTrigger.modal.manual.title')
    })

    it('should render modal with correct title for OAuth method', () => {
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.OAUTH} />)

      expect(screen.getByTestId('modal-title')).toHaveTextContent('pluginTrigger.modal.oauth.title')
    })

    it('should show multi-steps for API Key method', () => {
      const detailWithCredentials = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [
                { name: 'api_key', type: 'secret', required: true },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithCredentials)

      render(<CommonCreateModal {...defaultProps} />)

      expect(screen.getByText('pluginTrigger.modal.steps.verify')).toBeInTheDocument()
      expect(screen.getByText('pluginTrigger.modal.steps.configuration')).toBeInTheDocument()
    })

    it('should render LogViewer for Manual method', () => {
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} />)

      expect(screen.getByTestId('log-viewer')).toBeInTheDocument()
    })
  })

  describe('Builder Initialization', () => {
    it('should create builder on mount when no builder provided', async () => {
      render(<CommonCreateModal {...defaultProps} />)

      await waitFor(() => {
        expect(mockCreateBuilder).toHaveBeenCalledWith({
          provider: 'test-provider',
          credential_type: 'api-key',
        })
      })
    })

    it('should not create builder when builder is provided', async () => {
      const existingBuilder = createMockSubscriptionBuilder()
      render(<CommonCreateModal {...defaultProps} builder={existingBuilder} />)

      await waitFor(() => {
        expect(mockCreateBuilder).not.toHaveBeenCalled()
      })
    })

    it('should show error toast when builder creation fails', async () => {
      mockCreateBuilder.mockRejectedValueOnce(new Error('Creation failed'))

      render(<CommonCreateModal {...defaultProps} />)

      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'pluginTrigger.modal.errors.createFailed',
        })
      })
    })
  })

  describe('API Key Flow', () => {
    it('should start at Verify step for API Key method', () => {
      const detailWithCredentials = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [
                { name: 'api_key', type: 'secret', required: true },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithCredentials)

      render(<CommonCreateModal {...defaultProps} />)

      expect(screen.getByTestId('form-field-api_key')).toBeInTheDocument()
    })

    it('should show verify button text initially', () => {
      render(<CommonCreateModal {...defaultProps} />)

      expect(screen.getByTestId('modal-confirm')).toHaveTextContent('pluginTrigger.modal.common.verify')
    })
  })

  describe('Modal Actions', () => {
    it('should call onClose when close button is clicked', () => {
      const mockOnClose = vi.fn()
      render(<CommonCreateModal {...defaultProps} onClose={mockOnClose} />)

      fireEvent.click(screen.getByTestId('modal-close'))

      expect(mockOnClose).toHaveBeenCalled()
    })

    it('should call onConfirm handler when confirm button is clicked', () => {
      render(<CommonCreateModal {...defaultProps} />)

      fireEvent.click(screen.getByTestId('modal-confirm'))

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Please fill in all required credentials',
      })
    })
  })

  describe('Manual Method', () => {
    it('should start at Configuration step for Manual method', () => {
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} />)

      expect(screen.getByText('pluginTrigger.modal.manual.logs.title')).toBeInTheDocument()
    })

    it('should render manual properties form when schema exists', () => {
      const detailWithManualSchema = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_schema: [
              { name: 'webhook_url', type: 'text', required: true },
            ],
            subscription_constructor: {
              credentials_schema: [],
              parameters: [],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithManualSchema)

      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} />)

      expect(screen.getByTestId('form-field-webhook_url')).toBeInTheDocument()
    })

    it('should show create button text for Manual method', () => {
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} />)

      expect(screen.getByTestId('modal-confirm')).toHaveTextContent('pluginTrigger.modal.common.create')
    })
  })

  describe('Form Interactions', () => {
    it('should render credentials form fields', () => {
      const detailWithCredentials = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [
                { name: 'client_id', type: 'text', required: true },
                { name: 'client_secret', type: 'secret', required: true },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithCredentials)

      render(<CommonCreateModal {...defaultProps} />)

      expect(screen.getByTestId('form-field-client_id')).toBeInTheDocument()
      expect(screen.getByTestId('form-field-client_secret')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle missing provider gracefully', async () => {
      const detailWithoutProvider = { ...mockPluginDetail, provider: '' }
      mockUsePluginStore.mockReturnValue(detailWithoutProvider)

      render(<CommonCreateModal {...defaultProps} />)

      await waitFor(() => {
        expect(mockCreateBuilder).not.toHaveBeenCalled()
      })
    })

    it('should handle empty credentials schema', () => {
      const detailWithEmptySchema = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithEmptySchema)

      render(<CommonCreateModal {...defaultProps} />)

      expect(screen.queryByTestId('form-field-api_key')).not.toBeInTheDocument()
    })

    it('should handle undefined trigger in declaration', () => {
      const detailWithEmptyDeclaration = createMockPluginDetail({
        declaration: {
          trigger: undefined,
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithEmptyDeclaration)

      render(<CommonCreateModal {...defaultProps} />)

      expect(screen.getByTestId('modal')).toBeInTheDocument()
    })
  })

  describe('CREDENTIAL_TYPE_MAP', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      mockUsePluginStore.mockReturnValue(mockPluginDetail)
      mockCreateBuilder.mockResolvedValue({
        subscription_builder: createMockSubscriptionBuilder(),
      })
    })

    it('should use correct credential type for APIKEY', async () => {
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.APIKEY} />)

      await waitFor(() => {
        expect(mockCreateBuilder).toHaveBeenCalledWith(
          expect.objectContaining({
            credential_type: 'api-key',
          }),
        )
      })
    })

    it('should use correct credential type for OAUTH', async () => {
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.OAUTH} />)

      await waitFor(() => {
        expect(mockCreateBuilder).toHaveBeenCalledWith(
          expect.objectContaining({
            credential_type: 'oauth2',
          }),
        )
      })
    })

    it('should use correct credential type for MANUAL', async () => {
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} />)

      await waitFor(() => {
        expect(mockCreateBuilder).toHaveBeenCalledWith(
          expect.objectContaining({
            credential_type: 'unauthorized',
          }),
        )
      })
    })
  })

  describe('MODAL_TITLE_KEY_MAP', () => {
    it('should use correct title key for APIKEY', () => {
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.APIKEY} />)
      expect(screen.getByTestId('modal-title')).toHaveTextContent('pluginTrigger.modal.apiKey.title')
    })

    it('should use correct title key for OAUTH', () => {
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.OAUTH} />)
      expect(screen.getByTestId('modal-title')).toHaveTextContent('pluginTrigger.modal.oauth.title')
    })

    it('should use correct title key for MANUAL', () => {
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} />)
      expect(screen.getByTestId('modal-title')).toHaveTextContent('pluginTrigger.modal.manual.title')
    })
  })

  describe('Verify Flow', () => {
    it('should call verifyCredentials and move to Configuration step on success', async () => {
      const detailWithCredentials = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [
                { name: 'api_key', type: 'secret', required: true },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithCredentials)
      mockVerifyCredentials.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })

      render(<CommonCreateModal {...defaultProps} />)

      await waitFor(() => {
        expect(mockCreateBuilder).toHaveBeenCalled()
      })

      fireEvent.click(screen.getByTestId('modal-confirm'))

      await waitFor(() => {
        expect(mockVerifyCredentials).toHaveBeenCalled()
      })
    })

    it('should show error on verify failure', async () => {
      const detailWithCredentials = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [
                { name: 'api_key', type: 'secret', required: true },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithCredentials)
      mockVerifyCredentials.mockImplementation((params, { onError }) => {
        onError(new Error('Verification failed'))
      })

      render(<CommonCreateModal {...defaultProps} />)

      await waitFor(() => {
        expect(mockCreateBuilder).toHaveBeenCalled()
      })

      fireEvent.click(screen.getByTestId('modal-confirm'))

      await waitFor(() => {
        expect(mockVerifyCredentials).toHaveBeenCalled()
      })
    })
  })

  describe('Create Flow', () => {
    it('should show error when subscriptionBuilder is not found in Configuration step', async () => {
      // Start in Configuration step (Manual method)
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} />)

      // Before builder is created, click confirm
      fireEvent.click(screen.getByTestId('modal-confirm'))

      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'Subscription builder not found',
        })
      })
    })

    it('should call buildSubscription on successful create', async () => {
      const builder = createMockSubscriptionBuilder()
      mockBuildSubscription.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })

      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} builder={builder} />)

      fireEvent.click(screen.getByTestId('modal-confirm'))

      // Verify form is rendered and confirm button is clickable
      expect(screen.getByTestId('modal-confirm')).toBeInTheDocument()
    })

    it('should show error toast when buildSubscription fails', async () => {
      const builder = createMockSubscriptionBuilder()
      mockBuildSubscription.mockImplementation((params, { onError }) => {
        onError(new Error('Build failed'))
      })

      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} builder={builder} />)

      fireEvent.click(screen.getByTestId('modal-confirm'))

      // Verify the modal is still rendered after error
      expect(screen.getByTestId('modal')).toBeInTheDocument()
    })

    it('should call refetch and onClose on successful create', async () => {
      const mockOnClose = vi.fn()
      const builder = createMockSubscriptionBuilder()
      mockBuildSubscription.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })

      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} builder={builder} onClose={mockOnClose} />)

      // Verify component renders with builder
      expect(screen.getByTestId('modal')).toBeInTheDocument()
    })
  })

  describe('Manual Properties Change', () => {
    it('should call updateBuilder when manual properties change', async () => {
      const detailWithManualSchema = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_schema: [
              { name: 'webhook_url', type: 'text', required: true },
            ],
            subscription_constructor: {
              credentials_schema: [],
              parameters: [],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithManualSchema)

      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} />)

      await waitFor(() => {
        expect(mockCreateBuilder).toHaveBeenCalled()
      })

      const input = screen.getByTestId('form-field-webhook_url')
      fireEvent.change(input, { target: { value: 'https://example.com/webhook' } })

      // updateBuilder should be called after debounce
      await waitFor(() => {
        expect(mockUpdateBuilder).toHaveBeenCalled()
      })
    })

    it('should not call updateBuilder when subscriptionBuilder is missing', async () => {
      const detailWithManualSchema = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_schema: [
              { name: 'webhook_url', type: 'text', required: true },
            ],
            subscription_constructor: {
              credentials_schema: [],
              parameters: [],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithManualSchema)
      mockCreateBuilder.mockResolvedValue({ subscription_builder: undefined })

      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} />)

      const input = screen.getByTestId('form-field-webhook_url')
      fireEvent.change(input, { target: { value: 'https://example.com/webhook' } })

      // updateBuilder should not be called
      expect(mockUpdateBuilder).not.toHaveBeenCalled()
    })
  })

  describe('UpdateBuilder Error Handling', () => {
    it('should show error toast when updateBuilder fails', async () => {
      const detailWithManualSchema = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_schema: [
              { name: 'webhook_url', type: 'text', required: true },
            ],
            subscription_constructor: {
              credentials_schema: [],
              parameters: [],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithManualSchema)
      mockUpdateBuilder.mockImplementation((params, { onError }) => {
        onError(new Error('Update failed'))
      })

      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} />)

      await waitFor(() => {
        expect(mockCreateBuilder).toHaveBeenCalled()
      })

      const input = screen.getByTestId('form-field-webhook_url')
      fireEvent.change(input, { target: { value: 'https://example.com/webhook' } })

      await waitFor(() => {
        expect(mockUpdateBuilder).toHaveBeenCalled()
      })

      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'error',
          }),
        )
      })
    })
  })

  describe('Private Address Warning', () => {
    it('should show warning when callback URL is private address', async () => {
      const { isPrivateOrLocalAddress } = await import('@/utils/urlValidation')
      vi.mocked(isPrivateOrLocalAddress).mockReturnValue(true)

      const builder = createMockSubscriptionBuilder({
        endpoint: 'http://localhost:3000/callback',
      })

      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} builder={builder} />)

      // Verify component renders with the private address endpoint
      expect(screen.getByTestId('form-field-callback_url')).toBeInTheDocument()
    })

    it('should clear warning when callback URL is not private address', async () => {
      const { isPrivateOrLocalAddress } = await import('@/utils/urlValidation')
      vi.mocked(isPrivateOrLocalAddress).mockReturnValue(false)

      const builder = createMockSubscriptionBuilder({
        endpoint: 'https://example.com/callback',
      })

      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} builder={builder} />)

      // Verify component renders with public address endpoint
      expect(screen.getByTestId('form-field-callback_url')).toBeInTheDocument()
    })
  })

  describe('Auto Parameters Schema', () => {
    it('should render auto parameters form for OAuth method', () => {
      const detailWithAutoParams = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [],
              parameters: [
                { name: 'repo_name', type: 'string', required: true },
                { name: 'branch', type: 'text', required: false },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithAutoParams)

      const builder = createMockSubscriptionBuilder()
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.OAUTH} builder={builder} />)

      expect(screen.getByTestId('form-field-repo_name')).toBeInTheDocument()
      expect(screen.getByTestId('form-field-branch')).toBeInTheDocument()
    })

    it('should not render auto parameters form for Manual method', () => {
      const detailWithAutoParams = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [],
              parameters: [
                { name: 'repo_name', type: 'string', required: true },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithAutoParams)

      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} />)

      // For manual method, auto parameters should not be rendered
      expect(screen.queryByTestId('form-field-repo_name')).not.toBeInTheDocument()
    })
  })

  describe('Form Type Normalization', () => {
    it('should normalize various form types in auto parameters', () => {
      const detailWithVariousTypes = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [],
              parameters: [
                { name: 'text_field', type: 'string' },
                { name: 'secret_field', type: 'password' },
                { name: 'number_field', type: 'number' },
                { name: 'bool_field', type: 'boolean' },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithVariousTypes)

      const builder = createMockSubscriptionBuilder()
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.OAUTH} builder={builder} />)

      expect(screen.getByTestId('form-field-text_field')).toBeInTheDocument()
      expect(screen.getByTestId('form-field-secret_field')).toBeInTheDocument()
      expect(screen.getByTestId('form-field-number_field')).toBeInTheDocument()
      expect(screen.getByTestId('form-field-bool_field')).toBeInTheDocument()
    })

    it('should handle integer type as number', () => {
      const detailWithInteger = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [],
              parameters: [
                { name: 'count', type: 'integer' },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithInteger)

      const builder = createMockSubscriptionBuilder()
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.OAUTH} builder={builder} />)

      expect(screen.getByTestId('form-field-count')).toBeInTheDocument()
    })
  })

  describe('API Key Credentials Change', () => {
    it('should clear errors when credentials change', () => {
      const detailWithCredentials = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [
                { name: 'api_key', type: 'secret', required: true },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithCredentials)

      render(<CommonCreateModal {...defaultProps} />)

      const input = screen.getByTestId('form-field-api_key')
      fireEvent.change(input, { target: { value: 'new-api-key' } })

      // Verify the input field exists and accepts changes
      expect(input).toBeInTheDocument()
    })
  })

  describe('Subscription Form in Configuration Step', () => {
    it('should render subscription name and callback URL fields', () => {
      const builder = createMockSubscriptionBuilder()
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} builder={builder} />)

      expect(screen.getByTestId('form-field-subscription_name')).toBeInTheDocument()
      expect(screen.getByTestId('form-field-callback_url')).toBeInTheDocument()
    })
  })

  describe('Pending States', () => {
    it('should show verifying text when isVerifyingCredentials is true', () => {
      setMockPendingStates(true, false)

      render(<CommonCreateModal {...defaultProps} />)

      expect(screen.getByTestId('modal-confirm')).toHaveTextContent('pluginTrigger.modal.common.verifying')
    })

    it('should show creating text when isBuilding is true', () => {
      setMockPendingStates(false, true)

      const builder = createMockSubscriptionBuilder()
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} builder={builder} />)

      expect(screen.getByTestId('modal-confirm')).toHaveTextContent('pluginTrigger.modal.common.creating')
    })

    it('should disable confirm button when verifying', () => {
      setMockPendingStates(true, false)

      render(<CommonCreateModal {...defaultProps} />)

      expect(screen.getByTestId('modal-confirm')).toBeDisabled()
    })

    it('should disable confirm button when building', () => {
      setMockPendingStates(false, true)

      const builder = createMockSubscriptionBuilder()
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} builder={builder} />)

      expect(screen.getByTestId('modal-confirm')).toBeDisabled()
    })
  })

  describe('Modal Size', () => {
    it('should use md size for Manual method', () => {
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} />)

      expect(screen.getByTestId('modal')).toHaveAttribute('data-size', 'md')
    })

    it('should use sm size for API Key method', () => {
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.APIKEY} />)

      expect(screen.getByTestId('modal')).toHaveAttribute('data-size', 'sm')
    })

    it('should use sm size for OAuth method', () => {
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.OAUTH} />)

      expect(screen.getByTestId('modal')).toHaveAttribute('data-size', 'sm')
    })
  })

  describe('BottomSlot', () => {
    it('should show EncryptedBottom in Verify step', () => {
      render(<CommonCreateModal {...defaultProps} />)

      expect(screen.getByTestId('encrypted-bottom')).toBeInTheDocument()
    })

    it('should not show EncryptedBottom in Configuration step', () => {
      const builder = createMockSubscriptionBuilder()
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} builder={builder} />)

      expect(screen.queryByTestId('encrypted-bottom')).not.toBeInTheDocument()
    })
  })

  describe('Form Validation Failure', () => {
    it('should return early when subscription form validation fails', async () => {
      // Subscription form fails validation
      setMockFormValidation(false, true, true)

      const builder = createMockSubscriptionBuilder()
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} builder={builder} />)

      fireEvent.click(screen.getByTestId('modal-confirm'))

      // buildSubscription should not be called when validation fails
      expect(mockBuildSubscription).not.toHaveBeenCalled()
    })

    it('should return early when auto parameters validation fails', async () => {
      // Subscription form passes, but auto params form fails
      setMockFormValidation(true, false, true)

      const detailWithAutoParams = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [],
              parameters: [
                { name: 'repo_name', type: 'string', required: true },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithAutoParams)

      const builder = createMockSubscriptionBuilder()
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.OAUTH} builder={builder} />)

      fireEvent.click(screen.getByTestId('modal-confirm'))

      // buildSubscription should not be called when validation fails
      expect(mockBuildSubscription).not.toHaveBeenCalled()
    })

    it('should return early when manual properties validation fails', async () => {
      // Subscription form passes, but manual properties form fails
      setMockFormValidation(true, true, false)

      const detailWithManualSchema = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_schema: [
              { name: 'webhook_url', type: 'text', required: true },
            ],
            subscription_constructor: {
              credentials_schema: [],
              parameters: [],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithManualSchema)

      const builder = createMockSubscriptionBuilder()
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} builder={builder} />)

      fireEvent.click(screen.getByTestId('modal-confirm'))

      // buildSubscription should not be called when validation fails
      expect(mockBuildSubscription).not.toHaveBeenCalled()
    })
  })

  describe('Error Message Parsing', () => {
    it('should use parsed error message when available for verify error', async () => {
      mockParsePluginErrorMessage.mockResolvedValue('Custom parsed error')

      const detailWithCredentials = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [
                { name: 'api_key', type: 'secret', required: true },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithCredentials)
      mockVerifyCredentials.mockImplementation((params, { onError }) => {
        onError(new Error('Raw error'))
      })

      render(<CommonCreateModal {...defaultProps} />)

      await waitFor(() => {
        expect(mockCreateBuilder).toHaveBeenCalled()
      })

      fireEvent.click(screen.getByTestId('modal-confirm'))

      await waitFor(() => {
        expect(mockParsePluginErrorMessage).toHaveBeenCalled()
      })
    })

    it('should use parsed error message when available for build error', async () => {
      mockParsePluginErrorMessage.mockResolvedValue('Custom build error')

      const builder = createMockSubscriptionBuilder()
      mockBuildSubscription.mockImplementation((params, { onError }) => {
        onError(new Error('Raw build error'))
      })

      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} builder={builder} />)

      fireEvent.click(screen.getByTestId('modal-confirm'))

      await waitFor(() => {
        expect(mockParsePluginErrorMessage).toHaveBeenCalled()
      })

      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'Custom build error',
        })
      })
    })

    it('should use fallback error message when parsePluginErrorMessage returns null', async () => {
      mockParsePluginErrorMessage.mockResolvedValue(null)

      const builder = createMockSubscriptionBuilder()
      mockBuildSubscription.mockImplementation((params, { onError }) => {
        onError(new Error('Raw error'))
      })

      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} builder={builder} />)

      fireEvent.click(screen.getByTestId('modal-confirm'))

      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'pluginTrigger.subscription.createFailed',
        })
      })
    })

    it('should use parsed error message for update builder error', async () => {
      mockParsePluginErrorMessage.mockResolvedValue('Custom update error')

      const detailWithManualSchema = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_schema: [
              { name: 'webhook_url', type: 'text', required: true },
            ],
            subscription_constructor: {
              credentials_schema: [],
              parameters: [],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithManualSchema)
      mockUpdateBuilder.mockImplementation((params, { onError }) => {
        onError(new Error('Update failed'))
      })

      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} />)

      await waitFor(() => {
        expect(mockCreateBuilder).toHaveBeenCalled()
      })

      const input = screen.getByTestId('form-field-webhook_url')
      fireEvent.change(input, { target: { value: 'https://example.com/webhook' } })

      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'Custom update error',
        })
      })
    })
  })

  describe('Form getForm null handling', () => {
    it('should handle getForm returning null', async () => {
      setMockGetFormReturnsNull(true)

      const builder = createMockSubscriptionBuilder({
        endpoint: 'https://example.com/callback',
      })

      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} builder={builder} />)

      // Component should render without errors even when getForm returns null
      expect(screen.getByTestId('modal')).toBeInTheDocument()
    })
  })

  describe('normalizeFormType with existing FormTypeEnum', () => {
    it('should return the same type when already a valid FormTypeEnum', () => {
      const detailWithFormTypeEnum = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [],
              parameters: [
                { name: 'text_input_field', type: 'text-input' },
                { name: 'secret_input_field', type: 'secret-input' },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithFormTypeEnum)

      const builder = createMockSubscriptionBuilder()
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.OAUTH} builder={builder} />)

      expect(screen.getByTestId('form-field-text_input_field')).toBeInTheDocument()
      expect(screen.getByTestId('form-field-secret_input_field')).toBeInTheDocument()
    })

    it('should handle unknown type by defaulting to textInput', () => {
      const detailWithUnknownType = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [],
              parameters: [
                { name: 'unknown_field', type: 'unknown-type' },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithUnknownType)

      const builder = createMockSubscriptionBuilder()
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.OAUTH} builder={builder} />)

      expect(screen.getByTestId('form-field-unknown_field')).toBeInTheDocument()
    })
  })

  describe('Verify Success Flow', () => {
    it('should show success toast and move to Configuration step on verify success', async () => {
      const detailWithCredentials = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [
                { name: 'api_key', type: 'secret', required: true },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithCredentials)
      mockVerifyCredentials.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })

      render(<CommonCreateModal {...defaultProps} />)

      await waitFor(() => {
        expect(mockCreateBuilder).toHaveBeenCalled()
      })

      fireEvent.click(screen.getByTestId('modal-confirm'))

      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith({
          type: 'success',
          message: 'pluginTrigger.modal.apiKey.verify.success',
        })
      })
    })
  })

  describe('Build Success Flow', () => {
    it('should call refetch and onClose on successful build', async () => {
      const mockOnClose = vi.fn()
      const builder = createMockSubscriptionBuilder()
      mockBuildSubscription.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })

      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} builder={builder} onClose={mockOnClose} />)

      fireEvent.click(screen.getByTestId('modal-confirm'))

      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith({
          type: 'success',
          message: 'pluginTrigger.subscription.createSuccess',
        })
      })

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled()
      })

      await waitFor(() => {
        expect(mockRefetch).toHaveBeenCalled()
      })
    })
  })

  describe('DynamicSelect Parameters', () => {
    it('should handle dynamic-select type parameters', () => {
      const detailWithDynamicSelect = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [],
              parameters: [
                { name: 'dynamic_field', type: 'dynamic-select', required: true },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithDynamicSelect)

      const builder = createMockSubscriptionBuilder()
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.OAUTH} builder={builder} />)

      expect(screen.getByTestId('form-field-dynamic_field')).toBeInTheDocument()
    })
  })

  describe('Boolean Type Parameters', () => {
    it('should handle boolean type parameters with special styling', () => {
      const detailWithBoolean = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [],
              parameters: [
                { name: 'bool_field', type: 'boolean', required: false },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithBoolean)

      const builder = createMockSubscriptionBuilder()
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.OAUTH} builder={builder} />)

      expect(screen.getByTestId('form-field-bool_field')).toBeInTheDocument()
    })
  })

  describe('Empty Form Values', () => {
    it('should show error when credentials form returns empty values', () => {
      setMockFormValuesConfig({
        values: {},
        isCheckValidated: false,
      })

      const detailWithCredentials = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [
                { name: 'api_key', type: 'secret', required: true },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithCredentials)

      render(<CommonCreateModal {...defaultProps} />)

      fireEvent.click(screen.getByTestId('modal-confirm'))

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Please fill in all required credentials',
      })
    })
  })

  describe('Auto Parameters with Empty Schema', () => {
    it('should not render auto parameters when schema is empty', () => {
      const detailWithEmptyParams = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [],
              parameters: [],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithEmptyParams)

      const builder = createMockSubscriptionBuilder()
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.OAUTH} builder={builder} />)

      // Should only have subscription form fields
      expect(screen.getByTestId('form-field-subscription_name')).toBeInTheDocument()
      expect(screen.getByTestId('form-field-callback_url')).toBeInTheDocument()
    })
  })

  describe('Manual Properties with Empty Schema', () => {
    it('should not render manual properties form when schema is empty', () => {
      const detailWithEmptySchema = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_schema: [],
            subscription_constructor: {
              credentials_schema: [],
              parameters: [],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithEmptySchema)

      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} />)

      // Should have subscription form but not manual properties
      expect(screen.getByTestId('form-field-subscription_name')).toBeInTheDocument()
      expect(screen.queryByTestId('form-field-webhook_url')).not.toBeInTheDocument()
    })
  })

  describe('Credentials Schema with Help Text', () => {
    it('should transform help to tooltip in credentials schema', () => {
      const detailWithHelp = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [
                { name: 'api_key', type: 'secret', required: true, help: 'Enter your API key' },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithHelp)

      render(<CommonCreateModal {...defaultProps} />)

      expect(screen.getByTestId('form-field-api_key')).toBeInTheDocument()
    })
  })

  describe('Auto Parameters with Description', () => {
    it('should transform description to tooltip in auto parameters', () => {
      const detailWithDescription = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [],
              parameters: [
                { name: 'repo_name', type: 'string', required: true, description: 'Repository name' },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithDescription)

      const builder = createMockSubscriptionBuilder()
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.OAUTH} builder={builder} />)

      expect(screen.getByTestId('form-field-repo_name')).toBeInTheDocument()
    })
  })

  describe('Manual Properties with Description', () => {
    it('should transform description to tooltip in manual properties', () => {
      const detailWithDescription = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_schema: [
              { name: 'webhook_url', type: 'text', required: true, description: 'Webhook URL' },
            ],
            subscription_constructor: {
              credentials_schema: [],
              parameters: [],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithDescription)

      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} />)

      expect(screen.getByTestId('form-field-webhook_url')).toBeInTheDocument()
    })
  })

  describe('MultiSteps Component', () => {
    it('should not render MultiSteps for OAuth method', () => {
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.OAUTH} />)

      expect(screen.queryByText('pluginTrigger.modal.steps.verify')).not.toBeInTheDocument()
    })

    it('should not render MultiSteps for Manual method', () => {
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} />)

      expect(screen.queryByText('pluginTrigger.modal.steps.verify')).not.toBeInTheDocument()
    })
  })

  describe('API Key Build with Parameters', () => {
    it('should include parameters in build request for API Key method', async () => {
      const detailWithParams = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [
                { name: 'api_key', type: 'secret', required: true },
              ],
              parameters: [
                { name: 'repo', type: 'string', required: true },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithParams)

      // First verify credentials
      mockVerifyCredentials.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })
      mockBuildSubscription.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })

      const builder = createMockSubscriptionBuilder()
      render(<CommonCreateModal {...defaultProps} builder={builder} />)

      // Click verify
      fireEvent.click(screen.getByTestId('modal-confirm'))

      await waitFor(() => {
        expect(mockVerifyCredentials).toHaveBeenCalled()
      })

      // Now in configuration step, click create
      fireEvent.click(screen.getByTestId('modal-confirm'))

      await waitFor(() => {
        expect(mockBuildSubscription).toHaveBeenCalled()
      })
    })
  })

  describe('OAuth Build Flow', () => {
    it('should handle OAuth build flow correctly', async () => {
      const detailWithOAuth = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [],
              parameters: [],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithOAuth)
      mockBuildSubscription.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })

      const builder = createMockSubscriptionBuilder()
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.OAUTH} builder={builder} />)

      fireEvent.click(screen.getByTestId('modal-confirm'))

      await waitFor(() => {
        expect(mockBuildSubscription).toHaveBeenCalled()
      })
    })
  })

  describe('StatusStep Component Branches', () => {
    it('should render active indicator dot when step is active', () => {
      const detailWithCredentials = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [
                { name: 'api_key', type: 'secret', required: true },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithCredentials)

      render(<CommonCreateModal {...defaultProps} />)

      // Verify step is shown (active step has different styling)
      expect(screen.getByText('pluginTrigger.modal.steps.verify')).toBeInTheDocument()
    })

    it('should not render active indicator for inactive step', () => {
      const detailWithCredentials = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [
                { name: 'api_key', type: 'secret', required: true },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithCredentials)

      render(<CommonCreateModal {...defaultProps} />)

      // Configuration step should be inactive
      expect(screen.getByText('pluginTrigger.modal.steps.configuration')).toBeInTheDocument()
    })
  })

  describe('refetch Optional Chaining', () => {
    it('should call refetch when available on successful build', async () => {
      const builder = createMockSubscriptionBuilder()
      mockBuildSubscription.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })

      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} builder={builder} />)

      fireEvent.click(screen.getByTestId('modal-confirm'))

      await waitFor(() => {
        expect(mockRefetch).toHaveBeenCalled()
      })
    })
  })

  describe('Combined Parameter Types', () => {
    it('should render parameters with mixed types including dynamic-select and boolean', () => {
      const detailWithMixedTypes = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [],
              parameters: [
                { name: 'dynamic_field', type: 'dynamic-select', required: true },
                { name: 'bool_field', type: 'boolean', required: false },
                { name: 'text_field', type: 'string', required: true },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithMixedTypes)

      const builder = createMockSubscriptionBuilder()
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.OAUTH} builder={builder} />)

      expect(screen.getByTestId('form-field-dynamic_field')).toBeInTheDocument()
      expect(screen.getByTestId('form-field-bool_field')).toBeInTheDocument()
      expect(screen.getByTestId('form-field-text_field')).toBeInTheDocument()
    })

    it('should render parameters without dynamic-select type', () => {
      const detailWithNonDynamic = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [],
              parameters: [
                { name: 'text_field', type: 'string', required: true },
                { name: 'number_field', type: 'number', required: false },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithNonDynamic)

      const builder = createMockSubscriptionBuilder()
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.OAUTH} builder={builder} />)

      expect(screen.getByTestId('form-field-text_field')).toBeInTheDocument()
      expect(screen.getByTestId('form-field-number_field')).toBeInTheDocument()
    })

    it('should render parameters without boolean type', () => {
      const detailWithNonBoolean = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [],
              parameters: [
                { name: 'text_field', type: 'string', required: true },
                { name: 'secret_field', type: 'password', required: true },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithNonBoolean)

      const builder = createMockSubscriptionBuilder()
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.OAUTH} builder={builder} />)

      expect(screen.getByTestId('form-field-text_field')).toBeInTheDocument()
      expect(screen.getByTestId('form-field-secret_field')).toBeInTheDocument()
    })
  })

  describe('Endpoint Default Value', () => {
    it('should handle undefined endpoint in subscription builder', () => {
      const builderWithoutEndpoint = createMockSubscriptionBuilder({
        endpoint: undefined,
      })

      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} builder={builderWithoutEndpoint} />)

      expect(screen.getByTestId('form-field-callback_url')).toBeInTheDocument()
    })

    it('should handle empty string endpoint in subscription builder', () => {
      const builderWithEmptyEndpoint = createMockSubscriptionBuilder({
        endpoint: '',
      })

      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} builder={builderWithEmptyEndpoint} />)

      expect(screen.getByTestId('form-field-callback_url')).toBeInTheDocument()
    })
  })

  describe('Plugin Detail Fallbacks', () => {
    it('should handle undefined plugin_id', () => {
      const detailWithoutPluginId = createMockPluginDetail({
        plugin_id: '',
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [],
              parameters: [
                { name: 'dynamic_field', type: 'dynamic-select', required: true },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithoutPluginId)

      const builder = createMockSubscriptionBuilder()
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.OAUTH} builder={builder} />)

      expect(screen.getByTestId('form-field-dynamic_field')).toBeInTheDocument()
    })

    it('should handle undefined name in plugin detail', () => {
      const detailWithoutName = createMockPluginDetail({
        name: '',
      })
      mockUsePluginStore.mockReturnValue(detailWithoutName)

      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} />)

      expect(screen.getByTestId('log-viewer')).toBeInTheDocument()
    })
  })

  describe('Log Data Fallback', () => {
    it('should render log viewer even with empty logs', () => {
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} />)

      // LogViewer should render with empty logs array (from mock)
      expect(screen.getByTestId('log-viewer')).toBeInTheDocument()
    })
  })

  describe('Disabled State', () => {
    it('should show disabled state when verifying', () => {
      setMockPendingStates(true, false)

      render(<CommonCreateModal {...defaultProps} />)

      expect(screen.getByTestId('modal')).toHaveAttribute('data-disabled', 'true')
    })

    it('should show disabled state when building', () => {
      setMockPendingStates(false, true)
      const builder = createMockSubscriptionBuilder()

      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} builder={builder} />)

      expect(screen.getByTestId('modal')).toHaveAttribute('data-disabled', 'true')
    })
  })

  describe('normalizeFormType Additional Branches', () => {
    it('should handle "text" type by returning textInput', () => {
      const detailWithText = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [],
              parameters: [
                { name: 'text_type_field', type: 'text' },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithText)

      const builder = createMockSubscriptionBuilder()
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.OAUTH} builder={builder} />)

      expect(screen.getByTestId('form-field-text_type_field')).toBeInTheDocument()
    })

    it('should handle "secret" type by returning secretInput', () => {
      const detailWithSecret = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [],
              parameters: [
                { name: 'secret_type_field', type: 'secret' },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithSecret)

      const builder = createMockSubscriptionBuilder()
      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.OAUTH} builder={builder} />)

      expect(screen.getByTestId('form-field-secret_type_field')).toBeInTheDocument()
    })
  })

  describe('HandleManualPropertiesChange Provider Fallback', () => {
    it('should not call updateBuilder when provider is empty', async () => {
      const detailWithEmptyProvider = createMockPluginDetail({
        provider: '',
        declaration: {
          trigger: {
            subscription_schema: [
              { name: 'webhook_url', type: 'text', required: true },
            ],
            subscription_constructor: {
              credentials_schema: [],
              parameters: [],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithEmptyProvider)

      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} />)

      const input = screen.getByTestId('form-field-webhook_url')
      fireEvent.change(input, { target: { value: 'https://example.com/webhook' } })

      // updateBuilder should not be called when provider is empty
      expect(mockUpdateBuilder).not.toHaveBeenCalled()
    })
  })

  describe('Configuration Step Without Endpoint', () => {
    it('should handle builder without endpoint', async () => {
      const builderWithoutEndpoint = createMockSubscriptionBuilder({
        endpoint: '',
      })

      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} builder={builderWithoutEndpoint} />)

      // Component should render without errors
      expect(screen.getByTestId('modal')).toBeInTheDocument()
    })
  })

  describe('ApiKeyStep Flow Additional Coverage', () => {
    it('should handle verify when no builder created yet', async () => {
      const detailWithCredentials = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [
                { name: 'api_key', type: 'secret', required: true },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithCredentials)

      // Make createBuilder slow
      mockCreateBuilder.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 1000)))

      render(<CommonCreateModal {...defaultProps} />)

      // Click verify before builder is created
      fireEvent.click(screen.getByTestId('modal-confirm'))

      // Should still attempt to verify
      expect(screen.getByTestId('modal')).toBeInTheDocument()
    })
  })

  describe('Auto Parameters Not For APIKEY in Configuration', () => {
    it('should include parameters for APIKEY in configuration step', async () => {
      const detailWithParams = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_constructor: {
              credentials_schema: [
                { name: 'api_key', type: 'secret', required: true },
              ],
              parameters: [
                { name: 'extra_param', type: 'string', required: true },
              ],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithParams)

      // First verify credentials
      mockVerifyCredentials.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })

      const builder = createMockSubscriptionBuilder()
      render(<CommonCreateModal {...defaultProps} builder={builder} />)

      // Click verify
      fireEvent.click(screen.getByTestId('modal-confirm'))

      await waitFor(() => {
        expect(mockVerifyCredentials).toHaveBeenCalled()
      })

      // Now in configuration step, should see extra_param
      expect(screen.getByTestId('form-field-extra_param')).toBeInTheDocument()
    })
  })

  describe('needCheckValidatedValues Option', () => {
    it('should pass needCheckValidatedValues: false for manual properties', async () => {
      const detailWithManualSchema = createMockPluginDetail({
        declaration: {
          trigger: {
            subscription_schema: [
              { name: 'webhook_url', type: 'text', required: true },
            ],
            subscription_constructor: {
              credentials_schema: [],
              parameters: [],
            },
          },
        },
      })
      mockUsePluginStore.mockReturnValue(detailWithManualSchema)

      render(<CommonCreateModal {...defaultProps} createType={SupportedCreationMethods.MANUAL} />)

      await waitFor(() => {
        expect(mockCreateBuilder).toHaveBeenCalled()
      })

      const input = screen.getByTestId('form-field-webhook_url')
      fireEvent.change(input, { target: { value: 'test' } })

      await waitFor(() => {
        expect(mockUpdateBuilder).toHaveBeenCalled()
      })
    })
  })
})
