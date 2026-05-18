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
  mockToastSuccess,
  mockCopy,
  mockIsPrivateOrLocalAddress,
} = vi.hoisted(() => ({
  mockHandleStatusCodeChange: vi.fn(),
  mockGenerateWebhookUrl: vi.fn(),
  mockHandleMethodChange: vi.fn(),
  mockHandleContentTypeChange: vi.fn(),
  mockHandleHeadersChange: vi.fn(),
  mockHandleParamsChange: vi.fn(),
  mockHandleBodyChange: vi.fn(),
  mockHandleResponseBodyChange: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockCopy: vi.fn(),
  mockIsPrivateOrLocalAddress: vi.fn((_url: string) => false),
}))

vi.mock('@langgenius/dify-ui/select', async () => {
  const React = await import('react')
  const SelectContext = React.createContext<{
    disabled?: boolean
    onValueChange?: (value: string) => void
  }>({})

  return {
    Select: ({ children, disabled, onValueChange }: {
      children: React.ReactNode
      disabled?: boolean
      onValueChange?: (value: string) => void
    }) => (
      <SelectContext.Provider value={{ disabled, onValueChange }}>
        <div>{children}</div>
      </SelectContext.Provider>
    ),
    SelectTrigger: ({ children, className }: { children: React.ReactNode, className?: string }) => {
      const context = React.useContext(SelectContext)
      return (
        <div>
          <button data-testid="select-trigger" type="button" disabled={context.disabled} className={className}>
            {children}
          </button>
          <button data-testid="select-empty" type="button" onClick={() => context.onValueChange?.('')}>
            empty select value
          </button>
        </div>
      )
    },
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children: React.ReactNode, value: string }) => {
      const context = React.useContext(SelectContext)
      return (
        <button data-testid={`select-${value}`} type="button" onClick={() => context.onValueChange?.(value)}>
          {children}
        </button>
      )
    },
    SelectItemText: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SelectItemIndicator: () => null,
  }
})

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: mockToastSuccess,
  },
}))

vi.mock('copy-to-clipboard', () => ({
  default: mockCopy,
}))

vi.mock('@/app/components/base/input-with-copy', () => ({
  default: ({ value, placeholder, onCopy }: { value: string, placeholder: string, onCopy: () => void }) => (
    <div>
      <input value={value} placeholder={placeholder} readOnly />
      <button data-testid="copy-input" type="button" onClick={onCopy}>Copy</button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/field', () => ({
  default: ({ title, children }: { title: string, children: React.ReactNode }) => (
    <div>
      <span>{title}</span>
      {children}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/output-vars', () => ({
  default: ({ children, onCollapse, collapsed }: { children: React.ReactNode, onCollapse: (value: boolean) => void, collapsed: boolean }) => (
    <div>
      <button data-testid="toggle-output-vars" type="button" onClick={() => onCollapse(!collapsed)}>toggle output vars</button>
      {children}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/split', () => ({
  default: () => <div data-testid="split" />,
}))

vi.mock('../components/header-table', () => ({
  default: ({ onChange }: { onChange: (value: Array<Record<string, string>>) => void }) => (
    <button data-testid="header-table" type="button" onClick={() => onChange([{ key: 'Authorization', value: 'Bearer token' }])}>
      header table
    </button>
  ),
}))

vi.mock('../components/parameter-table', () => ({
  default: ({ title, onChange, placeholder, contentType }: {
    title: string
    onChange: (value: Array<Record<string, string>>) => void
    placeholder?: string
    contentType?: string
  }) => (
    <div>
      <span>{placeholder}</span>
      <span>{contentType}</span>
      <button data-testid={`parameter-${title}`} type="button" onClick={() => onChange([{ key: title, value: 'value' }])}>
        {title}
      </button>
    </div>
  ),
}))

vi.mock('../components/paragraph-input', () => ({
  default: ({ value, onChange, placeholder }: { value: string, onChange: (value: string) => void, placeholder: string }) => (
    <textarea value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
  ),
}))

vi.mock('../utils/render-output-vars', () => ({
  OutputVariablesContent: ({ variables }: { variables: unknown[] }) => <div data-testid="output-variables">{variables.length}</div>,
}))

vi.mock('@/utils/urlValidation', () => ({
  isPrivateOrLocalAddress: (url: string) => mockIsPrivateOrLocalAddress(url),
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
      expect(screen.getAllByText('application/json')[0]).toBeInTheDocument()
      expect(screen.getByDisplayValue('ok')).toBeInTheDocument()
      expect(mockGenerateWebhookUrl).not.toHaveBeenCalled()
    })

    it('should keep the content type selector aligned with the webhook url row width', () => {
      render(<Panel {...panelProps} />)

      const contentTypeTrigger = screen.getAllByTestId('select-trigger')[1]

      expect(contentTypeTrigger).toHaveClass('w-full')
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
    it('should handle method, content type, table, response, and copy actions', () => {
      render(<Panel {...panelProps} />)

      fireEvent.click(screen.getByTestId('copy-input'))
      fireEvent.click(screen.getByTestId('select-GET'))
      fireEvent.click(screen.getByTestId('select-text/plain'))
      fireEvent.click(screen.getByTestId('parameter-Query Parameters'))
      fireEvent.click(screen.getByTestId('header-table'))
      fireEvent.click(screen.getByTestId('parameter-Request Body Parameters'))
      fireEvent.change(screen.getByDisplayValue('ok'), { target: { value: 'updated body' } })
      fireEvent.click(screen.getByTestId('toggle-output-vars'))

      expect(mockToastSuccess).toHaveBeenCalledWith('workflow.nodes.triggerWebhook.urlCopied')
      expect(mockHandleMethodChange).toHaveBeenCalledWith('GET')
      expect(mockHandleContentTypeChange).toHaveBeenCalledWith('text/plain')
      expect(mockHandleParamsChange).toHaveBeenCalledWith([{ key: 'Query Parameters', value: 'value' }])
      expect(mockHandleHeadersChange).toHaveBeenCalledWith([{ key: 'Authorization', value: 'Bearer token' }])
      expect(mockHandleBodyChange).toHaveBeenCalledWith([{ key: 'Request Body Parameters', value: 'value' }])
      expect(mockHandleResponseBodyChange).toHaveBeenCalledWith('updated body')
    })

    it('should render the debug url card, copy it, and show the private-address warning', () => {
      vi.useFakeTimers()
      mockIsPrivateOrLocalAddress.mockReturnValue(true)
      mockConfigState.inputs = {
        ...mockConfigState.inputs,
        webhook_debug_url: 'http://127.0.0.1:8000/debug',
      }

      render(<Panel {...panelProps} />)

      fireEvent.click(screen.getByText('http://127.0.0.1:8000/debug'))

      expect(mockCopy).toHaveBeenCalledWith('http://127.0.0.1:8000/debug')
      expect(screen.getByText('workflow.nodes.triggerWebhook.debugUrlPrivateAddressWarning')).toBeInTheDocument()

      vi.runAllTimers()
      vi.useRealTimers()
    })

    it('should ignore empty method and content-type selections', () => {
      render(<Panel {...panelProps} />)

      fireEvent.click(screen.getAllByTestId('select-empty')[0]!)
      fireEvent.click(screen.getAllByTestId('select-empty')[1]!)

      expect(mockHandleMethodChange).not.toHaveBeenCalled()
      expect(mockHandleContentTypeChange).not.toHaveBeenCalled()
    })
  })
})
