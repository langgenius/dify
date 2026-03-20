import type { WebhookTriggerNodeType } from '../types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import type { PanelProps } from '@/types/workflow'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
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

const mockConfigState = {
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
  normalizeStatusCode: (statusCode: number) => Math.min(Math.max(statusCode, 200), 399),
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

const getStatusCodeInput = () => {
  return screen.getAllByDisplayValue('200')
    .find(element => element.getAttribute('aria-hidden') !== 'true') as HTMLInputElement
}

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
      expect(screen.getByText('application/json')).toBeInTheDocument()
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
})
