import type { WebhookTriggerNodeType } from '../types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import type { PanelProps } from '@/types/workflow'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import Panel from '../panel'

const {
  mockHandleStatusCodeChange,
  mockGenerateWebhookUrl,
  mockHandleMethodChange,
  mockHandleContentTypeChange,
  mockHandleHeadersChange,
  mockHandleParamsChange,
  mockHandleBodyChange,
  mockHandleResponseBodyChange,
} = vi.hoisted(() => ({
  mockHandleStatusCodeChange: vi.fn(),
  mockGenerateWebhookUrl: vi.fn(),
  mockHandleMethodChange: vi.fn(),
  mockHandleContentTypeChange: vi.fn(),
  mockHandleHeadersChange: vi.fn(),
  mockHandleParamsChange: vi.fn(),
  mockHandleBodyChange: vi.fn(),
  mockHandleResponseBodyChange: vi.fn(),
}))

const mockConfigState: {
  readOnly: boolean
  inputs: Pick<
    WebhookTriggerNodeType,
    | 'method'
    | 'webhook_url'
    | 'webhook_debug_url'
    | 'content_type'
    | 'headers'
    | 'params'
    | 'body'
    | 'status_code'
    | 'response_body'
    | 'variables'
  >
} = {
  readOnly: false,
  inputs: {
    method: 'POST',
    webhook_url: 'https://example.com/webhook',
    webhook_debug_url: '',
    content_type: 'application/json',
    headers: [],
    params: [],
    body: [],
    status_code: 200,
    response_body: 'ok',
    variables: [],
  },
}

vi.mock('../use-config', () => ({
  DEFAULT_STATUS_CODE: 200,
  MAX_STATUS_CODE: 399,
  useConfig: () => ({
    readOnly: mockConfigState.readOnly,
    inputs: mockConfigState.inputs,
    handleMethodChange: mockHandleMethodChange,
    handleContentTypeChange: mockHandleContentTypeChange,
    handleHeadersChange: mockHandleHeadersChange,
    handleParamsChange: mockHandleParamsChange,
    handleBodyChange: mockHandleBodyChange,
    handleStatusCodeChange: mockHandleStatusCodeChange,
    handleResponseBodyChange: mockHandleResponseBodyChange,
    generateWebhookUrl: mockGenerateWebhookUrl,
  }),
}))

const getStatusCodeInput = () =>
  screen.getByRole('textbox', {
    name: 'workflowIntegrations.nodes.triggerWebhook.statusCode',
  })

describe('WebhookTriggerPanel', () => {
  const panelProps: NodePanelProps<WebhookTriggerNodeType> = {
    id: 'node-1',
    data: {
      title: 'Webhook',
      desc: 'Webhook',
      type: BlockEnum.TriggerWebhook,
      method: 'POST',
      content_type: 'application/json',
      headers: [],
      params: [],
      body: [],
      async_mode: false,
      status_code: 200,
      response_body: 'ok',
      variables: [],
    },
    panelProps: {} as PanelProps,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockConfigState.readOnly = false
    mockConfigState.inputs = {
      method: 'POST',
      webhook_url: 'https://example.com/webhook',
      webhook_debug_url: '',
      content_type: 'application/json',
      headers: [],
      params: [],
      body: [],
      status_code: 200,
      response_body: 'ok',
      variables: [],
    }
  })

  describe('Rendering', () => {
    it('should render the real panel fields without generating a new webhook url when one already exists', () => {
      render(<Panel {...panelProps} />)

      expect(screen.getByDisplayValue('https://example.com/webhook')).toBeInTheDocument()
      expect(screen.getAllByText('application/json')[0]).toBeInTheDocument()
      expect(screen.getByDisplayValue('ok')).toBeInTheDocument()
      expect(mockGenerateWebhookUrl).not.toHaveBeenCalled()
    })

    it('should request a webhook url when the node is writable and missing one', async () => {
      mockConfigState.inputs = {
        ...mockConfigState.inputs,
        webhook_url: '',
      }

      render(<Panel {...panelProps} />)

      await waitFor(() => {
        expect(mockGenerateWebhookUrl).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('Status Code Input', () => {
    it('should update the status code when users enter a parseable value', () => {
      render(<Panel {...panelProps} />)

      fireEvent.change(getStatusCodeInput(), { target: { value: '201' } })

      expect(mockHandleStatusCodeChange).toHaveBeenCalledWith(201)
    })

    it('should ignore clear changes until the value is committed', () => {
      render(<Panel {...panelProps} />)

      const input = getStatusCodeInput()
      fireEvent.change(input, { target: { value: '' } })

      expect(mockHandleStatusCodeChange).not.toHaveBeenCalled()

      fireEvent.blur(input)

      expect(mockHandleStatusCodeChange).toHaveBeenCalledWith(200)
    })
  })

  describe('Interactions', () => {
    it('copies the labeled readonly webhook URL without editing it', async () => {
      const user = userEvent.setup()
      render(<Panel {...panelProps} />)
      const input = screen.getByRole('textbox', {
        name: 'workflowIntegrations.nodes.triggerWebhook.webhookUrl',
      })
      expect(input).toHaveAttribute('readonly')
      await user.click(screen.getByText('workflowIntegrations.nodes.triggerWebhook.webhookUrl'))
      expect(input).toHaveFocus()
      await user.click(screen.getByRole('button', { name: 'common.operation.copy' }))
      expect(await navigator.clipboard.readText()).toBe('https://example.com/webhook')
      expect(
        await screen.findByRole('button', {
          name: 'workflowIntegrations.nodes.triggerWebhook.urlCopied',
        }),
      ).toHaveFocus()
    })

    it('should handle method, content type, table, and response actions', async () => {
      const user = userEvent.setup()
      render(<Panel {...panelProps} />)

      await user.click(
        screen.getByRole('combobox', { name: 'workflowIntegrations.nodes.triggerWebhook.method' }),
      )
      await user.click(await screen.findByRole('option', { name: 'GET' }))
      await user.click(
        screen.getByRole('combobox', {
          name: 'workflowIntegrations.nodes.triggerWebhook.contentType',
        }),
      )
      await user.click(await screen.findByRole('option', { name: 'text/plain' }))
      const [query, header, body] = screen.getAllByRole('textbox', {
        name: 'workflowIntegrations.nodes.triggerWebhook.varName',
      })
      await user.click(query!)
      await user.paste('search')
      await user.click(header!)
      await user.paste('Authorization')
      await user.click(body!)
      await user.paste('message')
      const responseBody = screen.getByDisplayValue<HTMLTextAreaElement>('ok')
      await user.click(responseBody)
      responseBody.select()
      await user.paste('updated body')

      expect(mockHandleMethodChange).toHaveBeenCalledWith('GET')
      expect(mockHandleContentTypeChange).toHaveBeenCalledWith('text/plain')
      expect(mockHandleParamsChange).toHaveBeenCalledWith([
        { name: 'search', type: VarType.string, required: false },
      ])
      expect(mockHandleHeadersChange).toHaveBeenCalledWith([
        { name: 'Authorization', required: false },
      ])
      expect(mockHandleBodyChange).toHaveBeenCalledWith([
        { name: 'message', type: VarType.string, required: false },
      ])
      expect(mockHandleResponseBodyChange).toHaveBeenCalledWith('updated body')
    })

    it('prevents configuration changes and URL generation in readonly mode', async () => {
      const user = userEvent.setup()
      mockConfigState.readOnly = true
      mockConfigState.inputs = {
        ...mockConfigState.inputs,
        webhook_url: '',
        headers: [{ name: 'Authorization', required: true }],
        params: [{ name: 'search', type: VarType.string, required: false }],
        body: [{ name: 'message', type: VarType.string, required: false }],
      }
      render(<Panel {...panelProps} />)

      for (const input of screen.getAllByRole('textbox', {
        name: 'workflowIntegrations.nodes.triggerWebhook.varName',
      })) {
        expect(input).toBeDisabled()
        await user.type(input, 'changed')
      }
      for (const select of screen.getAllByRole('combobox')) expect(select).toBeDisabled()
      expect(getStatusCodeInput()).toBeDisabled()
      expect(screen.getByDisplayValue('ok')).toBeDisabled()
      expect(screen.queryByRole('button', { name: 'Delete row' })).not.toBeInTheDocument()
      expect(mockGenerateWebhookUrl).not.toHaveBeenCalled()
      expect(mockHandleHeadersChange).not.toHaveBeenCalled()
      expect(mockHandleParamsChange).not.toHaveBeenCalled()
      expect(mockHandleBodyChange).not.toHaveBeenCalled()
    })

    it('copies the debug URL from the keyboard and announces success while keeping its visible name', async () => {
      const user = userEvent.setup()
      mockConfigState.inputs = {
        ...mockConfigState.inputs,
        webhook_debug_url: 'http://127.0.0.1:8000/debug',
      }

      render(<Panel {...panelProps} />)

      const button = screen.getByRole('button', {
        name: 'workflowIntegrations.nodes.triggerWebhook.debugUrlTitle http://127.0.0.1:8000/debug workflowIntegrations.nodes.triggerWebhook.debugUrlCopy',
      })
      await user.click(
        screen.getByRole('textbox', {
          name: 'workflowIntegrations.nodes.triggerWebhook.webhookUrl',
        }),
      )
      await user.tab()
      await user.tab()
      expect(button).toHaveFocus()
      await user.keyboard('{Enter}')
      expect(await navigator.clipboard.readText()).toBe('http://127.0.0.1:8000/debug')
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent(
          'workflowIntegrations.nodes.triggerWebhook.debugUrlCopied',
        ),
      )
      expect(button).toHaveFocus()
      expect(
        screen.getByText('workflowIntegrations.nodes.triggerWebhook.debugUrlPrivateAddressWarning'),
      ).toBeInTheDocument()
    })
  })
})
