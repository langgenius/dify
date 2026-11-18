import type {
  EnvironmentMcpServer,
  EnvironmentTrigger,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { ReactElement } from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { render } from '@/test/console/render'
import { createTestQueryClient } from '@/test/query-client'
import { EnvironmentMcpCard } from '../deployed-environment-access-points/environment-mcp-card'
import { EnvironmentTriggerCard } from '../deployed-environment-access-points/environment-trigger-card'

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.test/en${path}`,
}))

vi.mock('@/service/use-triggers', () => ({
  useAllTriggerPlugins: () => ({ data: [] }),
}))

vi.mock('@/app/notifications', () => {
  const toast = vi.fn()
  return { toast: Object.assign(toast, { error: vi.fn(), success: vi.fn() }) }
})

// An in-memory enterprise. The MCP server row exists only after POST, as on the real endpoint, and
// every server answer describes the serving revision.
let server: EnvironmentMcpServer | null
let serving: Pick<EnvironmentMcpServer, 'inputs' | 'trigger_workflow'>
let triggerEnabled: boolean
let triggers: EnvironmentTrigger[]
let requests: string[]

function renderCard(ui: ReactElement) {
  return render(
    <QueryClientTestProvider queryClient={createTestQueryClient()}>{ui}</QueryClientTestProvider>,
  )
}

const writes = () => requests.filter((request) => !request.startsWith('GET'))

beforeEach(() => {
  server = null
  serving = { inputs: [], trigger_workflow: false }
  triggerEnabled = false
  triggers = []
  requests = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    const route = /\/enterprise\/app-deploy\/apps\/app-1\/environments\/staging\/(.+)$/.exec(
      url.pathname,
    )?.[1]
    if (!route) throw new Error(`Unexpected request: ${request.method} ${url.pathname}`)
    const text = request.method === 'GET' ? '' : await request.text()
    const body = text ? JSON.parse(text) : undefined
    requests.push(`${request.method} ${route}${url.search}${body ? ` ${text}` : ''}`)
    switch (`${request.method} ${route}`) {
      case 'GET server':
        return Response.json({ ...server, ...serving })
      case 'POST server':
        server = {
          server_code: 'code-1',
          url: 'https://api.test/mcp/environment/code-1/mcp',
          enabled: true,
          description: '',
        }
        return Response.json({ ...server, ...serving })
      case 'PUT server':
        if (!server) return Response.json({ code: 404 }, { status: 404 })
        server = { ...server, ...body }
        return Response.json({ ...server, ...serving })
      case 'GET trigger':
        return Response.json({ enabled: triggerEnabled })
      case 'PATCH trigger':
        triggerEnabled = body.enabled
        return Response.json({ enabled: triggerEnabled })
      case 'GET triggers':
        return Response.json({ data: triggers })
    }
    const nodeId = /^triggers\/(.+)$/.exec(route)?.[1]
    if (nodeId && request.method === 'PATCH') {
      triggers = triggers.map((trigger) =>
        trigger.node_id === nodeId ? { ...trigger, status: body.status } : trigger,
      )
      return Response.json({})
    }
    throw new Error(`Unexpected request: ${request.method} ${url.pathname}`)
  })
})

afterAll(() => vi.unstubAllGlobals())

describe('EnvironmentMcpCard', () => {
  it('asks for a description and parameters before creating the server', async () => {
    serving.inputs = [{ variable: 'topic', type: 'text-input', required: true }]
    renderCard(<EnvironmentMcpCard appId="app-1" environmentId="staging" canManageAccessPoint />)
    const toggle = await screen.findByRole('switch', { name: 'tools.mcp.server.title' })

    await userEvent.click(toggle)
    const dialog = await screen.findByRole('dialog')
    // Nothing is created until the form is saved.
    expect(writes()).toEqual([])
    await userEvent.type(
      within(dialog).getByLabelText('tools.mcp.server.modal.description'),
      'Searches the docs',
    )
    await userEvent.type(within(dialog).getByLabelText('topic'), 'What to search for')
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'tools.mcp.server.modal.confirm' }),
    )

    await waitFor(() => expect(toggle).toBeChecked())
    expect(writes()).toEqual([
      'POST server',
      'PUT server {"enabled":true,"description":"Searches the docs","parameters":{"topic":"What to search for"}}',
    ])
    expect(screen.getByText('https://api.test/mcp/environment/code-1/mcp')).toBeInTheDocument()
  })

  it('edits an existing server without changing whether it serves', async () => {
    server = {
      server_code: 'code-1',
      url: 'https://api.test/mcp/x',
      enabled: false,
      description: 'kept',
      parameters: { topic: 'old' },
    }
    serving.inputs = [{ variable: 'topic', type: 'text-input' }]
    renderCard(<EnvironmentMcpCard appId="app-1" environmentId="staging" canManageAccessPoint />)

    await userEvent.click(await screen.findByRole('button', { name: /tools\.mcp\.server\.edit/ }))
    const dialog = await screen.findByRole('dialog')
    const topic = within(dialog).getByLabelText('topic')
    expect(topic).toHaveValue('old')
    await userEvent.clear(topic)
    await userEvent.type(topic, 'new')
    await userEvent.click(within(dialog).getByRole('button', { name: 'tools.mcp.modal.save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(writes()).toEqual([
      'PUT server {"enabled":false,"description":"kept","parameters":{"topic":"new"}}',
    ])
  })

  it('is unavailable for a workflow that starts from triggers, as in Built-in', async () => {
    server = { server_code: 'code-1', url: 'https://api.test/mcp/x', enabled: true }
    serving.trigger_workflow = true
    renderCard(<EnvironmentMcpCard appId="app-1" environmentId="staging" canManageAccessPoint />)

    expect(
      (await screen.findAllByText('deployments.health.ENVIRONMENT_STATUS_FAILED')).length,
    ).toBeGreaterThan(0)
    expect(screen.queryByRole('switch', { checked: true })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /tools\.mcp\.server\.edit/ })).toBeDisabled()
  })
})

describe('EnvironmentTriggerCard', () => {
  it('lists triggers like Built-in and switches the environment and each node', async () => {
    triggers = [
      {
        node_id: 'hook',
        title: 'Order webhook',
        trigger_type: 'trigger-webhook',
        status: 'enabled',
        native_enabled: true,
      },
      {
        node_id: '1794983262004',
        title: 'Nightly',
        trigger_type: 'trigger-schedule',
        status: 'disabled',
      },
      {
        node_id: 'issue',
        title: 'New issue',
        trigger_type: 'trigger-plugin',
        provider_name: 'github',
        status: 'enabled',
      },
    ]
    renderCard(
      <EnvironmentTriggerCard appId="app-1" environmentId="staging" canManageAccessPoint />,
    )
    const environment = await screen.findByRole('switch', { name: 'navigation.settings.trigger' })
    const nightly = await screen.findByRole('switch', { name: 'Nightly' })
    // Rows carry the node title and provider, never the node ID.
    expect(screen.getByText('github')).toBeInTheDocument()
    expect(screen.queryByText('1794983262004')).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Order webhook' })).toBeChecked()
    expect(environment).not.toBeChecked()

    await userEvent.click(environment)
    await waitFor(() => expect(environment).toBeChecked())
    await userEvent.click(nightly)
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Nightly' })).toBeChecked())

    expect(writes()).toEqual([
      'PATCH trigger {"enabled":true}',
      'PATCH triggers/1794983262004 {"status":"enabled"}',
    ])
  })
})
