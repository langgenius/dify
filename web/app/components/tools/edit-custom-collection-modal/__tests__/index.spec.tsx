import type { ModalContextState } from '@/context/modal-context'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  fireEvent,
  render as renderWithoutPricing,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { emojiCatalogOptions } from '@/app/components/base/icon-picker/emoji-data'
import { AuthHeaderPrefix, AuthType } from '@/app/components/tools/types'
import { toast } from '@/app/notifications'
import { parseParamsSchema } from '@/service/tools'
import EditCustomCollectionModal from '../index'

const onPricingUrlUpdate = vi.hoisted(() => vi.fn())

vi.mock('@/service/tools', () => ({
  parseParamsSchema: vi.fn(),
}))
const parseParamsSchemaMock = vi.mocked(parseParamsSchema)

vi.mock('@/context/modal-context', () => ({
  useModalContext: (): ModalContextState => ({
    hasBlockingModalOpen: false,
    setShowModerationSettingModal: vi.fn(),
    setShowExternalDataToolModal: vi.fn(),
    setShowAnnotationFullModal: vi.fn(),
    setShowModelModal: vi.fn(),
    setShowExternalKnowledgeAPIModal: vi.fn(),
    setShowOpeningModal: vi.fn(),
    setShowUpdatePluginModal: vi.fn(),
  }),
}))

vi.mock('@/context/i18n', async () => {
  const actual = await vi.importActual<typeof import('@/context/i18n')>('@/context/i18n')
  return {
    ...actual,
    useDocLink: () => (path?: string) => `https://docs.example.com${path ?? ''}`,
  }
})

function render(...args: Parameters<typeof renderWithoutPricing>) {
  args[0] = <NuqsTestingAdapter onUrlUpdate={onPricingUrlUpdate}>{args[0]}</NuqsTestingAdapter>
  return renderWithoutPricing(...args)
}

describe('EditCustomCollectionModal', () => {
  const mockOnHide = vi.fn()
  const mockOnAdd = vi.fn()
  const mockOnEdit = vi.fn()
  const mockOnRemove = vi.fn()
  const toastNotifySpy = vi.spyOn(toast, 'error').mockReturnValue('toast-error')

  beforeEach(() => {
    vi.clearAllMocks()
    toastNotifySpy.mockClear()
    parseParamsSchemaMock.mockResolvedValue({
      parameters_schema: [],
      schema_type: 'openapi',
    })
  })

  const renderModal = (props?: {
    payload?: {
      provider: string
      credentials: {
        auth_type: AuthType
        api_key_header?: string
        api_key_header_prefix?: AuthHeaderPrefix
        api_key_value?: string
      }
      schema_type: string
      schema: string
      icon: { content: string; background: string }
      privacy_policy?: string
      custom_disclaimer?: string
      labels?: string[]
      tools?: Array<{
        operation_id: string
        summary: string
        method: string
        server_url: string
        parameters: Array<{ name: string; label: { en_US: string; zh_Hans: string } }>
      }>
    }
    positionLeft?: boolean
    dialogClassName?: string
  }) =>
    render(
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
    it('should show error when provider name is missing', async () => {
      const user = userEvent.setup()
      renderModal()

      const schemaInput = screen.getByPlaceholderText('tools.createTool.schemaPlaceHolder')
      await user.clear(schemaInput)
      await user.click(schemaInput)
      await user.paste('{}')
      await waitFor(() => {
        expect(parseParamsSchemaMock).toHaveBeenCalledWith('{}')
      })

      await user.click(screen.getByText('common.operation.save'))

      await waitFor(() => {
        expect(toastNotifySpy).toHaveBeenCalledWith(
          'common.errorMsg.fieldRequired:{"field":"tools.createTool.name"}',
        )
      })
      expect(mockOnAdd).not.toHaveBeenCalled()
    })

    it('should show error when schema is missing', async () => {
      const user = userEvent.setup()
      renderModal()

      const providerInput = screen.getByPlaceholderText('tools.createTool.toolNamePlaceHolder')
      await user.clear(providerInput)
      await user.click(providerInput)
      await user.paste('provider')

      await user.click(screen.getByText('common.operation.save'))

      await waitFor(() => {
        expect(toastNotifySpy).toHaveBeenCalledWith(
          'common.errorMsg.fieldRequired:{"field":"tools.createTool.schema"}',
        )
      })
      expect(mockOnAdd).not.toHaveBeenCalled()
    })

    it('should save a valid custom collection', async () => {
      const user = userEvent.setup()
      renderModal()
      const providerInput = screen.getByPlaceholderText('tools.createTool.toolNamePlaceHolder')
      await user.clear(providerInput)
      await user.click(providerInput)
      await user.paste('provider')

      const schemaInput = screen.getByPlaceholderText('tools.createTool.schemaPlaceHolder')
      await user.clear(schemaInput)
      await user.click(schemaInput)
      await user.paste('{}')

      // Wait for parseParamsSchema to be called and state to be updated
      await waitFor(() => {
        expect(parseParamsSchemaMock).toHaveBeenCalledWith('{}')
      })

      // Flush pending state updates from parseParamsSchema promise resolution

      await act(async () => {
        await user.click(screen.getByText('common.operation.save'))
      })

      await waitFor(() => {
        expect(mockOnAdd).toHaveBeenCalledWith(
          expect.objectContaining({
            provider: 'provider',
            schema: '{}',
            schema_type: 'openapi',
            icon: {
              content: '🕵️',
              background: '#FEF7C3',
            },
            credentials: {
              auth_type: 'none',
            },
            labels: [],
          }),
        )
        expect(toastNotifySpy).not.toHaveBeenCalled()
      })
    })

    it('should call onHide when cancel is clicked', async () => {
      const user = userEvent.setup()
      renderModal()

      await user.click(screen.getByText('common.operation.cancel'))

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
      tools: [
        {
          operation_id: 'getUsers',
          summary: 'Get all users',
          method: 'GET',
          server_url: 'https://api.example.com/users',
          parameters: [
            {
              name: 'limit',
              label: { en_US: 'Limit', zh_Hans: '限制' },
            },
          ],
        },
      ],
    }

    it('should call onRemove when delete button is clicked', async () => {
      const user = userEvent.setup()
      renderModal({ payload: editPayload })

      await user.click(screen.getByText('common.operation.delete'))

      expect(mockOnRemove).toHaveBeenCalled()
    })

    it('should call onEdit with original_provider when saving in edit mode', async () => {
      const user = userEvent.setup()
      renderModal({ payload: editPayload })

      expect(screen.getByPlaceholderText('tools.createTool.schemaPlaceHolder')).toHaveValue(
        editPayload.schema,
      )
      // Change the provider name
      const providerInput = screen.getByPlaceholderText('tools.createTool.toolNamePlaceHolder')
      await user.clear(providerInput)
      await user.click(providerInput)
      await user.paste('updated-provider')

      await act(async () => {
        await user.click(screen.getByText('common.operation.save'))
      })

      await waitFor(() => {
        expect(mockOnEdit).toHaveBeenCalledWith(
          expect.objectContaining({
            provider: 'updated-provider',
            original_provider: 'existing-provider',
          }),
        )
      })
    })

    it('should strip credential fields when auth_type is none on save', async () => {
      const user = userEvent.setup()
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
        await user.click(screen.getByText('common.operation.save'))
      })

      await waitFor(() => {
        expect(mockOnEdit).toHaveBeenCalledWith(
          expect.objectContaining({
            credentials: {
              auth_type: AuthType.none,
            },
          }),
        )
        // These fields should NOT be present
        const callArg = mockOnEdit.mock.calls[0]![0]
        expect(callArg.credentials.api_key_header).toBeUndefined()
        expect(callArg.credentials.api_key_header_prefix).toBeUndefined()
        expect(callArg.credentials.api_key_value).toBeUndefined()
      })
    })
  })

  // Tests for Schema parsing
  describe('Schema Parsing', () => {
    it('should parse schema and update params when schema changes', async () => {
      const user = userEvent.setup()
      parseParamsSchemaMock.mockResolvedValueOnce({
        parameters_schema: [
          {
            operation_id: 'newOp',
            summary: 'New operation',
            method: 'POST',
            server_url: 'https://api.example.com/new',
            parameters: [],
          },
        ],
        schema_type: 'swagger',
      })

      renderModal()

      const schemaInput = screen.getByPlaceholderText('tools.createTool.schemaPlaceHolder')
      await user.clear(schemaInput)
      await user.click(schemaInput)
      await user.paste('{"swagger": "2.0"}')

      await waitFor(() => {
        expect(parseParamsSchemaMock).toHaveBeenCalledWith('{"swagger": "2.0"}')
      })

      await waitFor(() => {
        expect(screen.getByText('newOp'))!.toBeInTheDocument()
      })
    })

    it('should handle schema parse error and reset params', async () => {
      const user = userEvent.setup()
      parseParamsSchemaMock.mockRejectedValueOnce(new Error('Parse error'))
      renderModal({
        payload: {
          provider: 'provider',
          credentials: { auth_type: AuthType.none },
          schema_type: 'openapi',
          schema: '{}',
          icon: { content: '🔧', background: '#fff' },
          tools: [
            {
              operation_id: 'previousOp',
              summary: 'Previous operation',
              method: 'GET',
              server_url: 'https://example.com',
              parameters: [],
            },
          ],
        },
      })
      expect(screen.getByText('previousOp')).toBeInTheDocument()

      const schemaInput = screen.getByPlaceholderText('tools.createTool.schemaPlaceHolder')
      await user.clear(schemaInput)
      await user.click(schemaInput)
      await user.paste('invalid schema')

      await waitFor(() => {
        expect(parseParamsSchemaMock).toHaveBeenCalledWith('invalid schema')
      })

      await waitFor(() => expect(screen.queryByText('previousOp')).not.toBeInTheDocument())
    })
  })

  // Tests for Icon Section
  describe('Icon Section', () => {
    it('saves the confirmed icon without submitting the collection from the picker', async () => {
      const user = userEvent.setup()
      const client = new QueryClient()
      client.setQueryData(emojiCatalogOptions.queryKey, [])
      render(
        <QueryClientProvider client={client}>
          <EditCustomCollectionModal payload={undefined} onHide={mockOnHide} onAdd={mockOnAdd} />
        </QueryClientProvider>,
      )
      await user.type(
        screen.getByPlaceholderText('tools.createTool.toolNamePlaceHolder'),
        'provider',
      )
      fireEvent.change(screen.getByPlaceholderText('tools.createTool.schemaPlaceHolder'), {
        target: { value: '{}' },
      })
      await waitFor(() => expect(parseParamsSchemaMock).toHaveBeenCalledWith('{}'))
      await user.click(screen.getByRole('button', { name: 'tools.createTool.changeIcon' }))
      await user.click(screen.getByRole('radio', { name: 'app.iconPicker.color.green' }))
      await user.click(screen.getByRole('button', { name: 'app.iconPicker.ok' }))
      expect(mockOnAdd).not.toHaveBeenCalled()
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'app.iconPicker.title' }),
        ).not.toBeInTheDocument(),
      )
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
      expect(mockOnAdd).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ icon: { content: '🕵️', background: '#F3FEE7' } }),
      )
      client.clear()
    })
  })

  // Tests for Credentials Modal

  // Tests for Test API Modal
  describe('Test API Modal', () => {
    const payloadWithTools = {
      provider: 'test-provider',
      credentials: { auth_type: AuthType.none },
      schema_type: 'openapi',
      schema: '{}',
      icon: { content: '🔧', background: '#FFCC00' },
      tools: [
        {
          operation_id: 'testOp',
          summary: 'Test operation',
          method: 'POST',
          server_url: 'https://api.example.com/test',
          parameters: [],
        },
      ],
    }

    it('opens the API tester for the selected operation', async () => {
      const user = userEvent.setup()
      renderModal({ payload: payloadWithTools })

      // Find the test button
      const testButton = screen.getByText('tools.createTool.availableTools.test')
      await user.click(testButton)
      expect(screen.getByRole('button', { name: 'tools.test.title' })).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('tools.test.testResultPlaceholder')
    })

    it('should display tool information in the table', () => {
      renderModal({ payload: payloadWithTools })

      expect(screen.getByText('testOp'))!.toBeInTheDocument()
      expect(screen.getByText('Test operation'))!.toBeInTheDocument()
      expect(screen.getByText('POST'))!.toBeInTheDocument()
    })
  })

  // Tests for Privacy Policy and Custom Disclaimer
  describe('Privacy Policy and Custom Disclaimer', () => {
    it('should include privacy policy and custom disclaimer in save payload', async () => {
      const user = userEvent.setup()
      renderModal()

      const providerInput = screen.getByPlaceholderText('tools.createTool.toolNamePlaceHolder')
      await user.clear(providerInput)
      await user.click(providerInput)
      await user.paste('test-provider')

      const schemaInput = screen.getByPlaceholderText('tools.createTool.schemaPlaceHolder')
      await user.clear(schemaInput)
      await user.click(schemaInput)
      await user.paste('{}')

      const privacyInput = screen.getByPlaceholderText('tools.createTool.privacyPolicyPlaceholder')
      await user.clear(privacyInput)
      await user.click(privacyInput)
      await user.paste('https://privacy.example.com')

      const disclaimerInput = screen.getByPlaceholderText(
        'tools.createTool.customDisclaimerPlaceholder',
      )
      await user.clear(disclaimerInput)
      await user.click(disclaimerInput)
      await user.paste('My disclaimer')

      await waitFor(() => {
        expect(parseParamsSchemaMock).toHaveBeenCalledWith('{}')
      })

      await act(async () => {
        await user.click(screen.getByText('common.operation.save'))
      })

      await waitFor(() => {
        expect(mockOnAdd).toHaveBeenCalledWith(
          expect.objectContaining({
            privacy_policy: 'https://privacy.example.com',
            custom_disclaimer: 'My disclaimer',
          }),
        )
      })
    })
  })

  // Tests for Props

  // Tests for getPath helper function
  describe('URL Path Extraction', () => {
    const payloadWithVariousUrls = (serverUrl: string) => ({
      provider: 'test-provider',
      credentials: { auth_type: AuthType.none },
      schema_type: 'openapi',
      schema: '{}',
      icon: { content: '🔧', background: '#FFCC00' },
      tools: [
        {
          operation_id: 'testOp',
          summary: 'Test',
          method: 'GET',
          server_url: serverUrl,
          parameters: [],
        },
      ],
    })

    it('should extract path from full URL', () => {
      renderModal({ payload: payloadWithVariousUrls('https://api.example.com/users/list') })

      expect(screen.getByText('/users/list'))!.toBeInTheDocument()
    })

    it('should handle URL with encoded characters', () => {
      renderModal({ payload: payloadWithVariousUrls('https://api.example.com/users%20list') })

      expect(screen.getByText('/users list'))!.toBeInTheDocument()
    })

    it('should handle invalid URL by returning the original string', () => {
      renderModal({ payload: payloadWithVariousUrls('not-a-valid-url') })

      // Should show the original string
      // Should show the original string
      expect(screen.getByText('not-a-valid-url'))!.toBeInTheDocument()
    })
  })

  // Tests for Schema spec link
  describe('Schema Spec Link', () => {
    it('should render swagger spec link', () => {
      renderModal()

      const link = screen.getByText('tools.createTool.viewSchemaSpec')
      expect(link.closest('a'))!.toHaveAttribute('href', 'https://swagger.io/specification/')
      expect(link.closest('a'))!.toHaveAttribute('target', '_blank')
    })
  })
})
