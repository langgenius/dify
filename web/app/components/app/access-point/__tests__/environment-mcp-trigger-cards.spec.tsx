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

vi.mock('@/app/notifications', () => {
  const toast = vi.fn()
  return { toast: Object.assign(toast, { error: vi.fn(), success: vi.fn() }) }
})

// An in-memory enterprise: the MCP server exists only after POST, as on the real endpoint.
let server: EnvironmentMcpServer | null
let triggerEnabled: boolean
let triggers: EnvironmentTrigger[]
let requests: string[]

function renderCard(ui: ReactElement) {
  return render(
    <QueryClientTestProvider queryClient={createTestQueryClient()}>{ui}</QueryClientTestProvider>,
  )
}

beforeEach(() => {
  server = null
  triggerEnabled = false
  triggers = []
  requests = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const path = new URL(request.url).pathname
    const match = /\/enterprise\/app-deploy\/apps\/app-1\/environments\/staging\/(.+)$/.exec(path)
    const route = match?.[1]
    if (!route) throw new Error(`Unexpected request: ${request.method} ${path}`)
    const body =
      request.method === 'GET' || request.method === 'POST' ? undefined : await request.json()
    requests.push(`${request.method} ${route}${body ? ` ${JSON.stringify(body)}` : ''}`)
    switch (`${request.method} ${route}`) {
      case 'GET server':
        return Response.json(server ?? {})
      case 'POST server':
        server = {
          server_code: 'code-1',
          url: 'https://api.test/mcp/environment/code-1/mcp',
          enabled: false,
        }
        return Response.json(server)
      case 'PUT server':
        if (!server) return Response.json({ code: 404 }, { status: 404 })
        server = { ...server, ...body }
        return Response.json(server)
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
    throw new Error(`Unexpected request: ${request.method} ${path}`)
  })
})

afterAll(() => vi.unstubAllGlobals())

describe('EnvironmentMcpCard', () => {
  it('creates the server before enabling it the first time', async () => {
    renderCard(<EnvironmentMcpCard appId="app-1" environmentId="staging" canManageAccessPoint />)
    const toggle = await screen.findByRole('switch', { name: 'tools.mcp.server.title' })
    expect(toggle).not.toBeChecked()

    await userEvent.click(toggle)

    await waitFor(() => expect(toggle).toBeChecked())
    expect(requests.filter((request) => !request.startsWith('GET'))).toEqual([
      'POST server',
      'PUT server {"enabled":true,"description":"","parameters":{}}',
    ])
    expect(screen.getByText('https://api.test/mcp/environment/code-1/mcp')).toBeInTheDocument()
  })

  it('keeps an existing description when disabling', async () => {
    server = {
      server_code: 'code-1',
      url: 'https://api.test/mcp/x',
      enabled: true,
      description: 'kept',
    }
    renderCard(<EnvironmentMcpCard appId="app-1" environmentId="staging" canManageAccessPoint />)
    const toggle = await screen.findByRole('switch', { name: 'tools.mcp.server.title' })
    await waitFor(() => expect(toggle).toBeChecked())

    await userEvent.click(toggle)

    await waitFor(() => expect(toggle).not.toBeChecked())
    expect(requests.filter((request) => !request.startsWith('GET'))).toEqual([
      'PUT server {"enabled":false,"description":"kept","parameters":{}}',
    ])
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

    expect(requests.filter((request) => !request.startsWith('GET'))).toEqual([
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
    expect(
      within(screen.getByRole('switch', { name: 'hook' }).closest('div')!.parentElement!).getByText(
        'deployments.studio.accessPoint.triggerNativeEnabled',
      ),
    ).toBeInTheDocument()
  })
})
