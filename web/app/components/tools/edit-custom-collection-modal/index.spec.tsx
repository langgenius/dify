import type { ModalContextState } from '@/context/modal-context'
import type { ProviderContextState } from '@/context/provider-context'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Toast from '@/app/components/base/toast'
import { Plan } from '@/app/components/billing/type'
import { AuthHeaderPrefix, AuthType } from '@/app/components/tools/types'
import { parseParamsSchema } from '@/service/tools'
import EditCustomCollectionModal from './index'

vi.mock('ahooks', async () => {
  const actual = await vi.importActual<typeof import('ahooks')>('ahooks')
  return {
    ...actual,
    useDebounce: (value: unknown) => value,
  }
})

vi.mock('@/service/tools', () => ({
  parseParamsSchema: vi.fn(),
}))
const parseParamsSchemaMock = vi.mocked(parseParamsSchema)

const mockSetShowPricingModal = vi.fn()
const mockSetShowAccountSettingModal = vi.fn()
vi.mock('@/context/modal-context', () => ({
  useModalContext: (): ModalContextState => ({
    setShowAccountSettingModal: mockSetShowAccountSettingModal,
    setShowApiBasedExtensionModal: vi.fn(),
    setShowModerationSettingModal: vi.fn(),
    setShowExternalDataToolModal: vi.fn(),
    setShowPricingModal: mockSetShowPricingModal,
    setShowAnnotationFullModal: vi.fn(),
    setShowModelModal: vi.fn(),
    setShowExternalKnowledgeAPIModal: vi.fn(),
    setShowModelLoadBalancingModal: vi.fn(),
    setShowOpeningModal: vi.fn(),
    setShowUpdatePluginModal: vi.fn(),
    setShowEducationExpireNoticeModal: vi.fn(),
    setShowTriggerEventsLimitModal: vi.fn(),
  }),
}))

const mockUseProviderContext = vi.fn()
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => mockUseProviderContext(),
}))

vi.mock('@/context/i18n', async () => {
  const actual = await vi.importActual<typeof import('@/context/i18n')>('@/context/i18n')
  return {
    ...actual,
    useDocLink: () => (path?: string) => `https://docs.example.com${path ?? ''}`,
  }
})

// Mock EmojiPicker
vi.mock('@/app/components/base/emoji-picker', () => ({
  default: ({ onSelect, onClose }: { onSelect: (icon: string, background: string) => void, onClose: () => void }) => {
    return (
      <div data-testid="emoji-picker">
        <button data-testid="select-emoji" onClick={() => onSelect('🚀', '#FF0000')}>Select Emoji</button>
        <button data-testid="close-emoji-picker" onClick={onClose}>Close</button>
      </div>
    )
  },
}))

describe('EditCustomCollectionModal', () => {
  const mockOnHide = vi.fn()
  const mockOnAdd = vi.fn()
  const mockOnEdit = vi.fn()
  const mockOnRemove = vi.fn()
  const toastNotifySpy = vi.spyOn(Toast, 'notify')

  beforeEach(() => {
    vi.clearAllMocks()
    toastNotifySpy.mockClear()
    parseParamsSchemaMock.mockResolvedValue({
      parameters_schema: [],
      schema_type: 'openapi',
    })
    mockUseProviderContext.mockReturnValue({
      plan: {
        type: Plan.sandbox,
      },
      enableBilling: false,
      webappCopyrightEnabled: true,
    } as ProviderContextState)
  })

  const renderModal = (props?: {
    payload?: {
      provider: string
      credentials: { auth_type: AuthType, api_key_header?: string, api_key_header_prefix?: AuthHeaderPrefix, api_key_value?: string }
      schema_type: string
      schema: string
      icon: { content: string, background: string }
      privacy_policy?: string
      custom_disclaimer?: string
      labels?: string[]
      tools?: Array<{ operation_id: string, summary: string, method: string, server_url: string, parameters: Array<{ name: string, label: { en_US: string, zh_Hans: string } }> }>
    }
    positionLeft?: boolean
    dialogClassName?: string
  }) => render(
    <EditCustomCollectionModal
      payload={props?.payload}
      onHide={mockOnHide}
      onAdd={mockOnAdd}
      onEdit={mockOnEdit}
      onRemove={mockOnRemove}
      positionLeft={props?.positionLeft}
      dialogClassName={props?.dialogClassName}
    />,
  )

  // Tests for Add mode (no payload)
  describe('Add Mode', () => {
    it('should render add mode title when no payload', () => {
      renderModal()

      expect(screen.getByText('tools.createTool.title')).toBeInTheDocument()
    })

    it('should show error when provider name is missing', async () => {
      renderModal()

      const schemaInput = screen.getByPlaceholderText('tools.createTool.schemaPlaceHolder')
      fireEvent.change(schemaInput, { target: { value: '{}' } })
      await waitFor(() => {
        expect(parseParamsSchemaMock).toHaveBeenCalledWith('{}')
      })

      fireEvent.click(screen.getByText('common.operation.save'))

      await waitFor(() => {
        expect(toastNotifySpy).toHaveBeenCalledWith(expect.objectContaining({
          message: 'common.errorMsg.fieldRequired:{"field":"tools.createTool.name"}',
          type: 'error',
        }))
      })
      expect(mockOnAdd).not.toHaveBeenCalled()
    })

    it('should show error when schema is missing', async () => {
      renderModal()

      const providerInput = screen.getByPlaceholderText('tools.createTool.toolNamePlaceHolder')
      fireEvent.change(providerInput, { target: { value: 'provider' } })

      fireEvent.click(screen.getByText('common.operation.save'))

      await waitFor(() => {
        expect(toastNotifySpy).toHaveBeenCalledWith(expect.objectContaining({
          message: 'common.errorMsg.fieldRequired:{"field":"tools.createTool.schema"}',
          type: 'error',
        }))
      })
      expect(mockOnAdd).not.toHaveBeenCalled()
    })

    it('should save a valid custom collection', async () => {
      renderModal()
      const providerInput = screen.getByPlaceholderText('tools.createTool.toolNamePlaceHolder')
      fireEvent.change(providerInput, { target: { value: 'provider' } })

      const schemaInput = screen.getByPlaceholderText('tools.createTool.schemaPlaceHolder')
      fireEvent.change(schemaInput, { target: { value: '{}' } })

      await waitFor(() => {
        expect(parseParamsSchemaMock).toHaveBeenCalledWith('{}')
      })

      await act(async () => {
        fireEvent.click(screen.getByText('common.operation.save'))
      })

      await waitFor(() => {
        expect(mockOnAdd).toHaveBeenCalledWith(expect.objectContaining({
          provider: 'provider',
          schema: '{}',
          schema_type: 'openapi',
          credentials: {
            auth_type: 'none',
          },
          labels: [],
        }))
        expect(toastNotifySpy).not.toHaveBeenCalled()
      })
    })

    it('should call onHide when cancel is clicked', () => {
      renderModal()

      fireEvent.click(screen.getByText('common.operation.cancel'))

      expect(mockOnHide).toHaveBeenCalled()
    })
  })

  // Tests for Edit mode (with payload)
  describe('Edit Mode', () => {
    const editPayload = {
      provider: 'existing-provider',
      credentials: {
        auth_type: AuthType.apiKeyHeader,
        api_key_header: 'X-Api-Key',
        api_key_header_prefix: AuthHeaderPrefix.bearer,
        api_key_value: 'secret-key',
      },
      schema_type: 'openapi',
      schema: '{"openapi": "3.0.0"}',
      icon: { content: '🔧', background: '#FFCC00' },
      privacy_policy: 'https://example.com/privacy',
      custom_disclaimer: 'Use at your own risk',
      labels: ['api', 'tools'],
      tools: [{
        operation_id: 'getUsers',
        summary: 'Get all users',
        method: 'GET',
        server_url: 'https://api.example.com/users',
        parameters: [{
          name: 'limit',
          label: { en_US: 'Limit', zh_Hans: '限制' },
        }],
      }],
    }

    it('should render edit mode title when payload is provided', () => {
      renderModal({ payload: editPayload })

      expect(screen.getByText('tools.createTool.editTitle')).toBeInTheDocument()
    })

    it('should show delete button in edit mode', () => {
      renderModal({ payload: editPayload })

      expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
    })

    it('should call onRemove when delete button is clicked', () => {
      renderModal({ payload: editPayload })

      fireEvent.click(screen.getByText('common.operation.delete'))

      expect(mockOnRemove).toHaveBeenCalled()
    })

    it('should call onEdit with original_provider when saving in edit mode', async () => {
      renderModal({ payload: editPayload })

      // Change the provider name
      const providerInput = screen.getByPlaceholderText('tools.createTool.toolNamePlaceHolder')
      fireEvent.change(providerInput, { target: { value: 'updated-provider' } })

      await act(async () => {
        fireEvent.click(screen.getByText('common.operation.save'))
      })

      await waitFor(() => {
        expect(mockOnEdit).toHaveBeenCalledWith(expect.objectContaining({
          provider: 'updated-provider',
          original_provider: 'existing-provider',
        }))
      })
    })

    it('should display existing provider name', () => {
      renderModal({ payload: editPayload })

      const providerInput = screen.getByPlaceholderText('tools.createTool.toolNamePlaceHolder')
      expect(providerInput).toHaveValue('existing-provider')
    })

    it('should display existing schema', () => {
      renderModal({ payload: editPayload })

      const schemaInput = screen.getByPlaceholderText('tools.createTool.schemaPlaceHolder')
      expect(schemaInput).toHaveValue('{"openapi": "3.0.0"}')
    })

    it('should display available tools table', () => {
      renderModal({ payload: editPayload })

      expect(screen.getByText('getUsers')).toBeInTheDocument()
      expect(screen.getByText('Get all users')).toBeInTheDocument()
      expect(screen.getByText('GET')).toBeInTheDocument()
    })

    it('should strip credential fields when auth_type is none on save', async () => {
      const payloadWithNoneAuth = {
        ...editPayload,
        credentials: {
          auth_type: AuthType.none,
          api_key_header: 'should-be-removed',
          api_key_header_prefix: AuthHeaderPrefix.bearer,
          api_key_value: 'should-be-removed',
        },
      }

      renderModal({ payload: payloadWithNoneAuth })

      await act(async () => {
        fireEvent.click(screen.getByText('common.operation.save'))
      })

      await waitFor(() => {
        expect(mockOnEdit).toHaveBeenCalledWith(expect.objectContaining({
          credentials: {
            auth_type: AuthType.none,
          },
        }))
        // These fields should NOT be present
        const callArg = mockOnEdit.mock.calls[0][0]
        expect(callArg.credentials.api_key_header).toBeUndefined()
        expect(callArg.credentials.api_key_header_prefix).toBeUndefined()
        expect(callArg.credentials.api_key_value).toBeUndefined()
      })
    })
  })

  // Tests for Schema parsing
  describe('Schema Parsing', () => {
    it('should parse schema and update params when schema changes', async () => {
      parseParamsSchemaMock.mockResolvedValueOnce({
        parameters_schema: [{
          operation_id: 'newOp',
          summary: 'New operation',
          method: 'POST',
          server_url: 'https://api.example.com/new',
          parameters: [],
        }],
        schema_type: 'swagger',
      })

      renderModal()

      const schemaInput = screen.getByPlaceholderText('tools.createTool.schemaPlaceHolder')
      fireEvent.change(schemaInput, { target: { value: '{"swagger": "2.0"}' } })

      await waitFor(() => {
        expect(parseParamsSchemaMock).toHaveBeenCalledWith('{"swagger": "2.0"}')
      })

      await waitFor(() => {
        expect(screen.getByText('newOp')).toBeInTheDocument()
      })
    })

    it('should handle schema parse error and reset params', async () => {
      parseParamsSchemaMock.mockRejectedValueOnce(new Error('Parse error'))

      renderModal()

      const schemaInput = screen.getByPlaceholderText('tools.createTool.schemaPlaceHolder')
      fireEvent.change(schemaInput, { target: { value: 'invalid schema' } })

      await waitFor(() => {
        expect(parseParamsSchemaMock).toHaveBeenCalledWith('invalid schema')
      })

      // The table should still be visible but empty (no tools)
      expect(screen.getByText('tools.createTool.availableTools.title')).toBeInTheDocument()
    })

    it('should not parse schema when empty', async () => {
      renderModal()

      // Clear any calls from initial render
      parseParamsSchemaMock.mockClear()

      const schemaInput = screen.getByPlaceholderText('tools.createTool.schemaPlaceHolder')
      fireEvent.change(schemaInput, { target: { value: '' } })

      // Wait a bit and check that parseParamsSchema was not called with empty string
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(parseParamsSchemaMock).not.toHaveBeenCalledWith('')
    })
  })

  // Tests for Icon Section
  describe('Icon Section', () => {
    it('should render icon section', () => {
      renderModal()

      // The name input should be present
      const nameInput = screen.getByPlaceholderText('tools.createTool.toolNamePlaceHolder')
      expect(nameInput).toBeInTheDocument()
    })

    it('should render name input section', () => {
      renderModal()

      // Name label should be present
      expect(screen.getByText('tools.createTool.name')).toBeInTheDocument()
    })
  })

  // Tests for Credentials Modal
  describe('Credentials Modal', () => {
    it('should show auth method section title', () => {
      renderModal()

      expect(screen.getByText('tools.createTool.authMethod.title')).toBeInTheDocument()
    })

    it('should display current auth type', () => {
      renderModal()

      // The default auth type is 'none'
      expect(screen.getByText('tools.createTool.authMethod.types.none')).toBeInTheDocument()
    })
  })

  // Tests for Test API Modal
  describe('Test API Modal', () => {
    const payloadWithTools = {
      provider: 'test-provider',
      credentials: { auth_type: AuthType.none },
      schema_type: 'openapi',
      schema: '{}',
      icon: { content: '🔧', background: '#FFCC00' },
      tools: [{
        operation_id: 'testOp',
        summary: 'Test operation',
        method: 'POST',
        server_url: 'https://api.example.com/test',
        parameters: [],
      }],
    }

    it('should render test button in available tools table', () => {
      renderModal({ payload: payloadWithTools })

      // Find the test button
      const testButton = screen.getByText('tools.createTool.availableTools.test')
      expect(testButton).toBeInTheDocument()
    })

    it('should display tool information in the table', () => {
      renderModal({ payload: payloadWithTools })

      expect(screen.getByText('testOp')).toBeInTheDocument()
      expect(screen.getByText('Test operation')).toBeInTheDocument()
      expect(screen.getByText('POST')).toBeInTheDocument()
    })
  })

  // Tests for Privacy Policy and Custom Disclaimer
  describe('Privacy Policy and Custom Disclaimer', () => {
    it('should update privacy policy input', () => {
      renderModal()

      const privacyInput = screen.getByPlaceholderText('tools.createTool.privacyPolicyPlaceholder')
      fireEvent.change(privacyInput, { target: { value: 'https://example.com/privacy' } })

      expect(privacyInput).toHaveValue('https://example.com/privacy')
    })

    it('should update custom disclaimer input', () => {
      renderModal()

      const disclaimerInput = screen.getByPlaceholderText('tools.createTool.customDisclaimerPlaceholder')
      fireEvent.change(disclaimerInput, { target: { value: 'Custom disclaimer text' } })

      expect(disclaimerInput).toHaveValue('Custom disclaimer text')
    })

    it('should include privacy policy and custom disclaimer in save payload', async () => {
      renderModal()

      const providerInput = screen.getByPlaceholderText('tools.createTool.toolNamePlaceHolder')
      fireEvent.change(providerInput, { target: { value: 'test-provider' } })

      const schemaInput = screen.getByPlaceholderText('tools.createTool.schemaPlaceHolder')
      fireEvent.change(schemaInput, { target: { value: '{}' } })

      const privacyInput = screen.getByPlaceholderText('tools.createTool.privacyPolicyPlaceholder')
      fireEvent.change(privacyInput, { target: { value: 'https://privacy.example.com' } })

      const disclaimerInput = screen.getByPlaceholderText('tools.createTool.customDisclaimerPlaceholder')
      fireEvent.change(disclaimerInput, { target: { value: 'My disclaimer' } })

      await waitFor(() => {
        expect(parseParamsSchemaMock).toHaveBeenCalledWith('{}')
      })

      await act(async () => {
        fireEvent.click(screen.getByText('common.operation.save'))
      })

      await waitFor(() => {
        expect(mockOnAdd).toHaveBeenCalledWith(expect.objectContaining({
          privacy_policy: 'https://privacy.example.com',
          custom_disclaimer: 'My disclaimer',
        }))
      })
    })
  })

  // Tests for Props
  describe('Props', () => {
    it('should render with positionLeft prop', () => {
      renderModal({ positionLeft: true })

      expect(screen.getByText('tools.createTool.title')).toBeInTheDocument()
    })

    it('should render with dialogClassName prop', () => {
      renderModal({ dialogClassName: 'custom-dialog-class' })

      expect(screen.getByText('tools.createTool.title')).toBeInTheDocument()
    })
  })

  // Tests for getPath helper function
  describe('URL Path Extraction', () => {
    const payloadWithVariousUrls = (serverUrl: string) => ({
      provider: 'test-provider',
      credentials: { auth_type: AuthType.none },
      schema_type: 'openapi',
      schema: '{}',
      icon: { content: '🔧', background: '#FFCC00' },
      tools: [{
        operation_id: 'testOp',
        summary: 'Test',
        method: 'GET',
        server_url: serverUrl,
        parameters: [],
      }],
    })

    it('should extract path from full URL', () => {
      renderModal({ payload: payloadWithVariousUrls('https://api.example.com/users/list') })

      expect(screen.getByText('/users/list')).toBeInTheDocument()
    })

    it('should handle URL with encoded characters', () => {
      renderModal({ payload: payloadWithVariousUrls('https://api.example.com/users%20list') })

      expect(screen.getByText('/users list')).toBeInTheDocument()
    })

    it('should handle empty URL', () => {
      renderModal({ payload: payloadWithVariousUrls('') })

      // Should not crash and show the row
      expect(screen.getByText('testOp')).toBeInTheDocument()
    })

    it('should handle invalid URL by returning the original string', () => {
      renderModal({ payload: payloadWithVariousUrls('not-a-valid-url') })

      // Should show the original string
      expect(screen.getByText('not-a-valid-url')).toBeInTheDocument()
    })

    it('should handle URL with only domain', () => {
      renderModal({ payload: payloadWithVariousUrls('https://api.example.com') })

      // Path would be empty or "/"
      expect(screen.getByText('testOp')).toBeInTheDocument()
    })
  })

  // Tests for Schema spec link
  describe('Schema Spec Link', () => {
    it('should render swagger spec link', () => {
      renderModal()

      const link = screen.getByText('tools.createTool.viewSchemaSpec')
      expect(link.closest('a')).toHaveAttribute('href', 'https://swagger.io/specification/')
      expect(link.closest('a')).toHaveAttribute('target', '_blank')
    })
  })
})
