import type { WebhookTriggerNodeType } from '../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { renderNodePanel } from '../../__tests__/render-node-panel'
import Panel from '../panel'

const request = vi.hoisted(() => vi.fn())
vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: { call: request } }))
const createData = (overrides: Partial<WebhookTriggerNodeType> = {}): WebhookTriggerNodeType => ({
  title: 'Webhook',
  desc: 'Webhook',
  type: BlockEnum.TriggerWebhook,
  method: 'POST',
  webhook_url: 'https://example.com/webhook',
  webhook_debug_url: '',
  content_type: 'application/json',
  headers: [],
  params: [],
  body: [],
  async_mode: false,
  status_code: 200,
  response_body: 'ok',
  variables: [],
  ...overrides,
})
const renderPanel = (data = createData(), readOnly = false) =>
  renderNodePanel(Panel, data, {
    resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    initialStoreState: { canvasReadOnly: readOnly },
  })

const getStatusCodeInput = () =>
  screen.getByRole('textbox', {
    name: 'workflowIntegrations.nodes.triggerWebhook.statusCode',
  })

describe('WebhookTriggerPanel', () => {
  beforeEach(() => request.mockReset())

  describe('Rendering', () => {
    it('should render the real panel fields without generating a new webhook url when one already exists', () => {
      renderPanel()

      expect(screen.getByDisplayValue('https://example.com/webhook')).toBeInTheDocument()
      expect(screen.getAllByText('application/json')[0]).toBeInTheDocument()
      expect(screen.getByDisplayValue('ok')).toBeInTheDocument()
      expect(request).not.toHaveBeenCalled()
    })

    it('should request a webhook url when the node is writable and missing one', async () => {
      request.mockResolvedValue({
        webhook_url: 'https://example.com/generated',
        webhook_debug_url: 'https://example.com/debug',
      })
      const { data } = renderPanel(createData({ webhook_url: '' }))
      expect(await screen.findByDisplayValue('https://example.com/generated')).toBeInTheDocument()
      expect(data().webhook_url).toBe('https://example.com/generated')
      expect(request).toHaveBeenCalledWith(
        ['apps', 'byAppId', 'workflows', 'triggers', 'webhook', 'get'],
        { params: { app_id: 'app-1' }, query: { node_id: 'node' } },
        expect.any(Object),
      )
    })
  })

  describe('Status Code Input', () => {
    it('saves a parseable status code', async () => {
      const user = userEvent.setup()
      const { data } = renderPanel()
      await user.clear(getStatusCodeInput())
      await user.type(getStatusCodeInput(), '201')
      expect(data().status_code).toBe(201)
    })

    it('keeps the saved code while empty and restores the default on blur', async () => {
      const user = userEvent.setup()
      const { data } = renderPanel(createData({ status_code: 201 }))
      const input = getStatusCodeInput()
      await user.clear(input)
      expect(data().status_code).toBe(201)
      await user.tab()
      expect(data().status_code).toBe(200)
      expect(input).toHaveValue('200')
    })
  })

  describe('Interactions', () => {
    it('copies the labeled readonly webhook URL without editing it', async () => {
      const user = userEvent.setup()
      renderPanel()
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
      const { data } = renderPanel()

      await user.click(
        screen.getByRole('combobox', { name: 'workflowIntegrations.nodes.triggerWebhook.method' }),
      )
      await user.click(await screen.findByRole('option', { name: 'GET' }))
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

      expect(data()).toMatchObject({
        method: 'GET',
        params: [{ name: 'search', type: VarType.string, required: false }],
        headers: [{ name: 'Authorization', required: false }],
        body: [{ name: 'message', type: VarType.string, required: false }],
        response_body: 'updated body',
      })
      await user.click(
        screen.getByRole('combobox', {
          name: 'workflowIntegrations.nodes.triggerWebhook.contentType',
        }),
      )
      await user.click(await screen.findByRole('option', { name: 'text/plain' }))
      expect(data()).toMatchObject({
        content_type: 'text/plain',
        body: [],
        response_body: 'updated body',
      })
    })

    it('prevents configuration changes and URL generation in readonly mode', async () => {
      const user = userEvent.setup()
      const initial = createData({
        webhook_url: '',
        headers: [{ name: 'Authorization', required: true }],
        params: [{ name: 'search', type: VarType.string, required: false }],
        body: [{ name: 'message', type: VarType.string, required: false }],
      })
      const { data } = renderPanel(initial, true)

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
      expect(request).not.toHaveBeenCalled()
      expect(data()).toMatchObject(initial)
    })

    it('copies the debug URL from the keyboard and announces success while keeping its visible name', async () => {
      const user = userEvent.setup()
      renderPanel(createData({ webhook_debug_url: 'http://127.0.0.1:8000/debug' }))

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
