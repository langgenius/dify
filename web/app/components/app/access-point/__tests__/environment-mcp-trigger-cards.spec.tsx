import type {
  EnvironmentMcpServer,
  EnvironmentTrigger,
  TriggerLogEntry,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { ReactElement } from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { render } from '@/test/console/render'
import { createTestQueryClient } from '@/test/query-client'
import { EnvironmentMcpCard } from '../deployed-environment-access-points/environment-mcp-card'
import { EnvironmentTriggerCard } from '../deployed-environment-access-points/environment-trigger-card'

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
let logs: TriggerLogEntry[]
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
  logs = []
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
      case 'GET trigger-logs': {
        // Two logs per page: the cursor is the index of the next one.
        const start = Number(url.searchParams.get('cursor') || 0)
        const end = start + 2
        return Response.json({
          data: logs.slice(start, end),
          has_more: end < logs.length,
          next_cursor: String(end),
        })
      }
    }
    const nodeId = /^triggers\/(.+)$/.exec(route)?.[1]
    if (nodeId && request.method === 'PATCH') {
      triggers = triggers.map((trigger) =>
        trigger.node_id === nodeId ? { ...trigger, status: body.status } : trigger,
      )
      return Response.json({})
    }
    const rerun = /^trigger-logs\/(.+)\/rerun$/.exec(route)?.[1]
    if (rerun && request.method === 'POST') {
      logs = [{ id: 'rerun', node_id: 'hook', status: 'pending', rerun_of: rerun }, ...logs]
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

  it('offers no switch for a workflow that starts from triggers', async () => {
    server = { server_code: 'code-1', url: 'https://api.test/mcp/x', enabled: true }
    serving.trigger_workflow = true
    renderCard(<EnvironmentMcpCard appId="app-1" environmentId="staging" canManageAccessPoint />)

    expect(
      await screen.findByText('deployments.studio.accessPoint.mcpTriggerUnsupported'),
    ).toBeInTheDocument()
    expect(screen.getByText('deployments.studio.accessPoint.notSupported')).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByText('https://api.test/mcp/x')).not.toBeInTheDocument()
  })
})

describe('EnvironmentTriggerCard', () => {
  it('switches the environment and each node independently', async () => {
    triggers = [
      {
        node_id: 'hook',
        trigger_type: 'trigger-webhook',
        status: 'enabled',
        webhook_url: 'https://api.test/v2/triggers/webhook/w1',
      },
      { node_id: 'cron', trigger_type: 'trigger-schedule', status: 'disabled' },
    ]
    renderCard(
      <EnvironmentTriggerCard appId="app-1" environmentId="staging" canManageAccessPoint />,
    )
    const environment = await screen.findByRole('switch', { name: 'navigation.settings.trigger' })
    await waitFor(() => expect(screen.getByRole('switch', { name: 'cron' })).toBeInTheDocument())
    expect(environment).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'hook' })).toBeChecked()

    await userEvent.click(environment)
    await waitFor(() => expect(environment).toBeChecked())
    await userEvent.click(screen.getByRole('switch', { name: 'cron' }))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'cron' })).toBeChecked())

    expect(writes()).toEqual([
      'PATCH trigger {"enabled":true}',
      'PATCH triggers/cron {"status":"enabled"}',
    ])
    expect(screen.getByRole('switch', { name: 'hook' })).toBeChecked()
  })

  it('locks platform-set statuses and warns when the Built-in trigger also runs', async () => {
    triggers = [
      { node_id: 'plugin', trigger_type: 'trigger-plugin', status: 'unauthorized' },
      { node_id: 'hook', trigger_type: 'trigger-webhook', status: 'enabled', native_enabled: true },
      {
        node_id: 'quiet',
        trigger_type: 'trigger-webhook',
        status: 'disabled',
        native_enabled: true,
      },
    ]
    renderCard(
      <EnvironmentTriggerCard appId="app-1" environmentId="staging" canManageAccessPoint />,
    )

    const plugin = await screen.findByRole('switch', { name: 'plugin' })
    expect(plugin).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('unauthorized')).toBeInTheDocument()
    // Only the enabled node duplicates events; a disabled one runs nowhere here.
    expect(screen.getAllByText('deployments.studio.accessPoint.triggerNativeEnabled')).toHaveLength(
      1,
    )
  })

  it('pages through trigger logs and reruns a finished one', async () => {
    logs = [
      { id: 'l1', node_id: 'hook', status: 'started', run: { status: 'succeeded', duration: 0.5 } },
      { id: 'l2', node_id: 'hook', status: 'failed', failure_reason: 'BUSY' },
      { id: 'l3', node_id: 'hook', status: 'pending' },
    ]
    renderCard(
      <EnvironmentTriggerCard appId="app-1" environmentId="staging" canManageAccessPoint />,
    )

    await userEvent.click(await screen.findByRole('button', { name: /appLog\.title/ }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('BUSY')).toBeInTheDocument()
    expect(within(dialog).getAllByRole('row')).toHaveLength(3)

    await userEvent.click(within(dialog).getByRole('button', { name: 'workflow.common.loadMore' }))
    await waitFor(() => expect(within(dialog).getAllByRole('row')).toHaveLength(4))
    // A queued event has not run, so there is nothing to rerun yet.
    expect(
      within(dialog).getAllByRole('button', {
        name: 'deployments.studio.accessPoint.triggerLogRerun',
      }),
    ).toHaveLength(2)

    const failed = within(dialog).getByText('BUSY').closest('tr')!
    await userEvent.click(
      within(failed).getByRole('button', {
        name: 'deployments.studio.accessPoint.triggerLogRerun',
      }),
    )
    // The rerun is a new event at the top of the refreshed list.
    await waitFor(() => expect(within(dialog).getAllByRole('row')).toHaveLength(5))
    expect(writes()).toContain('POST trigger-logs/l2/rerun {}')
  })
})
