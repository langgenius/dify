import type { WebhookTriggerNodeType } from '../types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import type { PanelProps } from '@/types/workflow'
import { fireEvent, render, screen } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import Panel from '../panel'

const {
  mockHandleStatusCodeChange,
  mockGenerateWebhookUrl,
} = vi.hoisted(() => ({
  mockHandleStatusCodeChange: vi.fn(),
  mockGenerateWebhookUrl: vi.fn(),
}))

vi.mock('../use-config', () => ({
  DEFAULT_STATUS_CODE: 200,
  MAX_STATUS_CODE: 399,
  normalizeStatusCode: (statusCode: number) => Math.min(Math.max(statusCode, 200), 399),
  useConfig: () => ({
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
      response_body: '',
    },
    handleMethodChange: vi.fn(),
    handleContentTypeChange: vi.fn(),
    handleHeadersChange: vi.fn(),
    handleParamsChange: vi.fn(),
    handleBodyChange: vi.fn(),
    handleStatusCodeChange: mockHandleStatusCodeChange,
    handleResponseBodyChange: vi.fn(),
    generateWebhookUrl: mockGenerateWebhookUrl,
  }),
}))

vi.mock('@/app/components/base/input-with-copy', () => ({
  default: () => <div data-testid="input-with-copy" />,
}))

vi.mock('@/app/components/base/select', () => ({
  SimpleSelect: () => <div data-testid="simple-select" />,
}))

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/field', () => ({
  default: ({ title, children }: { title: React.ReactNode, children: React.ReactNode }) => (
    <section>
      <div>{title}</div>
      {children}
    </section>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/output-vars', () => ({
  default: () => <div data-testid="output-vars" />,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/split', () => ({
  default: () => <div data-testid="split" />,
}))

vi.mock('../components/header-table', () => ({
  default: () => <div data-testid="header-table" />,
}))

vi.mock('../components/parameter-table', () => ({
  default: () => <div data-testid="parameter-table" />,
}))

vi.mock('../components/paragraph-input', () => ({
  default: () => <div data-testid="paragraph-input" />,
}))

vi.mock('../utils/render-output-vars', () => ({
  OutputVariablesContent: () => <div data-testid="output-variables-content" />,
}))

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
      response_body: '',
      variables: [],
    },
    panelProps: {} as PanelProps,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should update the status code when users enter a parseable value', () => {
    render(<Panel {...panelProps} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '201' } })

    expect(mockHandleStatusCodeChange).toHaveBeenCalledWith(201)
  })

  it('should ignore clear changes until the value is committed', () => {
    render(<Panel {...panelProps} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '' } })

    expect(mockHandleStatusCodeChange).not.toHaveBeenCalled()

    fireEvent.blur(input)

    expect(mockHandleStatusCodeChange).toHaveBeenCalledWith(200)
  })
})
