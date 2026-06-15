import type { WebhookTriggerNodeType } from '../types'
import { screen } from '@testing-library/react'
import { renderNodeComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import Node from '../node'

const createNodeData = (overrides: Partial<WebhookTriggerNodeType> = {}): WebhookTriggerNodeType => ({
  title: 'Webhook Trigger',
  desc: '',
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
  ...overrides,
})

describe('TriggerWebhookNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The node should expose the webhook URL and keep a clear fallback for empty data.
  describe('Rendering', () => {
    it('should render the webhook url when it exists', () => {
      renderNodeComponent(Node, createNodeData({
        webhook_url: 'https://example.com/webhook',
      }))

      expect(screen.getByText('URL')).toBeInTheDocument()
      expect(screen.getByText('https://example.com/webhook')).toBeInTheDocument()
    })

    it('should render the placeholder when the webhook url is empty', () => {
      renderNodeComponent(Node, createNodeData({
        webhook_url: '',
      }))

      expect(screen.getByText('--')).toBeInTheDocument()
    })
  })
})
