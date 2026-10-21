import type {
  AppMode,
  TraceProviderCapabilitiesResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { httpErrorFromResponse } from '@/service/http-error'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { createDeferred } from '@/test/deferred'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { createTestQueryClient } from '@/test/query-client'
import { TracingConfiguration as Panel } from '../configuration'

const { request } = vi.hoisted(() => ({
  request:
    vi.fn<(url: string, init: RequestInit, options: { request: Request }) => Promise<Response>>(),
}))
vi.mock('@/service/base', () => ({ request }))

const langfuseConfig = {
  public_key: 'public-key',
  secret_key: '[__MASKED__]',
  host: 'https://cloud.langfuse.com',
}

const capabilities: TraceProviderCapabilitiesResponse = {
  provider: 'langfuse',
  agent_spans: true,
  session: true,
  native_usage: true,
  native_cost: true,
  trace_url: true,
  span_url: false,
  api_collection_enabled: true,
  export_ack: 'accepted',
}

let agentTracingEnabled = true

function mockServer(
  configured = true,
  initialStatus = { enabled: configured, tracing_provider: configured ? 'langfuse' : null },
) {
  let status = initialStatus
  let config: Record<string, unknown> | null = configured ? langfuseConfig : null
  const writes: Array<{ method: string; body: unknown }> = []
  request.mockImplementation(async (_url, _init, { request: sent }) => {
    const url = new URL(sent.url)
    if (url.pathname.endsWith('/system-features'))
      return Response.json(
        createSystemFeaturesFixture({ agent_tracing_api_collection_enabled: agentTracingEnabled }),
      )
    if (url.pathname.endsWith('/trace-capabilities')) return Response.json(capabilities)
    if (url.pathname.endsWith('/trace')) {
      if (sent.method === 'POST') {
        status = await sent.json()
        writes.push({ method: sent.method, body: status })
        return Response.json({ result: 'success' })
      }
      return Response.json(status)
    }
    if (sent.method === 'GET') {
      const providerConfig = url.searchParams.get('tracing_provider') === 'langfuse' ? config : null
      return Response.json({ tracing_config: providerConfig, has_not_configured: !providerConfig })
    }
    if (sent.method === 'DELETE') {
      config = null
      status = { ...status, enabled: false, tracing_provider: null }
      writes.push({ method: sent.method, body: null })
      return new Response(null, { status: 204 })
    }
    const body = await sent.json()
    writes.push({ method: sent.method, body })
    config = { ...body.tracing_config, secret_key: '[__MASKED__]' }
    if (body.activate)
      status = { ...status, enabled: true, tracing_provider: body.tracing_provider }
    return Response.json({ result: 'success' })
  })
  return writes
}

const requestedPaths = () =>
  request.mock.calls.map(([, , { request: sent }]) => new URL(sent.url).pathname)
const requested = (suffix: string) => requestedPaths().filter((path) => path.endsWith(suffix))

function renderPanel({
  readOnly = false,
  searchParams = '',
  mode = 'chat',
}: { readOnly?: boolean; searchParams?: string; mode?: AppMode } = {}) {
  const client = createTestQueryClient()
  const QueryWrapper = createQueryClientWrapper(client)
  const { wrapper: NuqsWrapper, onUrlUpdate } = createNuqsTestWrapper({
    searchParams,
    hasMemory: true,
  })
  const view = render(
    <Panel resource={{ kind: 'app', appId: 'app-1', mode }} readOnly={readOnly} />,
    {
      wrapper: ({ children }) => (
        <QueryWrapper>
          <NuqsWrapper>{children}</NuqsWrapper>
        </QueryWrapper>
      ),
    },
  )
  return { ...view, client, onUrlUpdate }
}

async function expandCapture(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /app\.tracing\.captureTitle/ }))
}

async function openConfiguredPanel() {
  const user = userEvent.setup()
  await user.click(await screen.findByText('app.tracing.enabled'))
  await screen.findByText('app.tracing.tracing')
  return user
}

describe('Tracing overview panel', () => {
  beforeEach(() => {
    agentTracingEnabled = true
  })

  it.each(['workflow', 'advanced-chat'] as const)(
    'reads and saves %s capture policy through the owning App',
    async (mode) => {
      const writes = mockServer()
      const { client } = renderPanel({ mode })
      const user = await openConfiguredPanel()
      await expandCapture(user)
      const content = screen.getByRole('switch', { name: 'app.tracing.captureContent' })
      const agent = screen.getByRole('switch', { name: 'app.tracing.captureAgent' })
      expect(content).not.toBeChecked()
      expect(agent).toBeChecked()
      expect(screen.getByRole('group', { name: 'app.tracing.captureTitle' })).toContainElement(
        content,
      )
      expect(content).toHaveAccessibleDescription('app.tracing.captureContentDescription')
      await user.click(content)
      await waitFor(() => expect(client.isMutating()).toBe(0))
      await user.click(agent)
      await waitFor(() => expect(client.isMutating()).toBe(0))
      expect(writes).toEqual([
        {
          method: 'POST',
          body: {
            enabled: true,
            tracing_provider: 'langfuse',
            capture_content: true,
            capture_agent: true,
          },
        },
        {
          method: 'POST',
          body: {
            enabled: true,
            tracing_provider: 'langfuse',
            capture_content: true,
            capture_agent: false,
          },
        },
      ])
      expect(
        client.getQueryData(
          consoleQuery.apps.byAppId.trace.get.queryKey({
            input: { params: { app_id: 'app-1' } },
          }),
        ),
      ).toMatchObject({ capture_content: true, capture_agent: false })
      expect(
        requestedPaths()
          .filter((path) => path.includes('/trace'))
          .every((path) => path.includes('/apps/app-1/')),
      ).toBe(true)
    },
  )

  it.each(['chat', 'completion', 'agent-chat'] as const)(
    'does not expose Agent capture policy for %s apps',
    async (mode) => {
      mockServer()
      renderPanel({ mode })
      await openConfiguredPanel()
      expect(
        screen.queryByRole('switch', { name: 'app.tracing.captureContent' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('switch', { name: 'app.tracing.captureAgent' }),
      ).not.toBeInTheDocument()
      expect(requested('/trace-capabilities')).toEqual([])
      expect(requested('/features')).toEqual([])
    },
  )

  it('keeps the last-known enabled deployment settings after a system-features refresh fails', async () => {
    const writes = mockServer()
    const { client } = renderPanel({ searchParams: 'tracing=configure', mode: 'workflow' })
    const user = userEvent.setup()
    await expandCapture(user)
    expect(screen.getByRole('switch', { name: 'app.tracing.captureAgent' })).toBeChecked()

    const server = request.getMockImplementation()!
    request.mockImplementation(async (...args) => {
      if (new URL(args[2].request.url).pathname.endsWith('/system-features'))
        throw await httpErrorFromResponse(
          Response.json({ message: 'System features unavailable' }, { status: 500 }),
        )
      return server(...args)
    })
    await act(async () => {
      await client.invalidateQueries({ queryKey: consoleQuery.systemFeatures.get.queryKey() })
    })

    expect(requested('/system-features')).toHaveLength(2)
    expect(screen.getByRole('switch', { name: 'app.tracing.captureAgent' })).toBeChecked()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
    expect(writes).toEqual([])
    expect(requested('/features')).toEqual([])
  })

  it('does not report a disabled deployment when the initial system-features request fails', async () => {
    mockServer()
    const server = request.getMockImplementation()!
    request.mockImplementation(async (...args) => {
      if (new URL(args[2].request.url).pathname.endsWith('/system-features'))
        throw await httpErrorFromResponse(
          Response.json({ message: 'System features unavailable' }, { status: 500 }),
        )
      return server(...args)
    })
    renderPanel({ searchParams: 'tracing=configure', mode: 'workflow' })

    await screen.findByRole('group', { name: 'app.tracing.langfuse.title' })
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'app.tracing.captureTitle' }),
    ).not.toBeInTheDocument()
    expect(requested('/trace-capabilities')).toEqual([])
    expect(requested('/features')).toEqual([])
  })

  it('keeps Workflow capture policy read-only without fetching provider credentials', async () => {
    const writes = mockServer()
    renderPanel({ readOnly: true, mode: 'workflow' })
    const user = await openConfiguredPanel()
    await expandCapture(user)
    const content = screen.getByRole('switch', { name: 'app.tracing.captureContent' })
    const agent = screen.getByRole('switch', { name: 'app.tracing.captureAgent' })
    await user.click(content)
    await user.click(agent)
    expect(content).not.toBeChecked()
    expect(agent).toBeChecked()
    expect(writes).toEqual([])
    expect(requested('/trace-config')).toEqual([])
  })

  it('serializes Workflow capture changes and restores the last saved policy on failure', async () => {
    const writes = mockServer()
    const server = request.getMockImplementation()!
    const saves: Array<{ complete: (fail?: boolean) => void }> = []
    request.mockImplementation(async (...args) => {
      const sent = args[2].request
      if (sent.method === 'POST' && new URL(sent.url).pathname.endsWith('/trace'))
        await new Promise<void>((resolve, reject) => {
          saves.push({
            complete: (fail) => (fail ? reject(new Error('Policy unavailable')) : resolve()),
          })
        })
      return server(...args)
    })
    const { client } = renderPanel({ mode: 'workflow' })
    const user = await openConfiguredPanel()
    await expandCapture(user)
    const content = screen.getByRole('switch', { name: 'app.tracing.captureContent' })
    const agent = screen.getByRole('switch', { name: 'app.tracing.captureAgent' })
    await user.click(content)
    await user.click(agent)
    expect(content).toBeChecked()
    expect(agent).not.toBeChecked()
    expect(saves).toHaveLength(1)
    await act(() => saves[0]!.complete())
    await waitFor(() => expect(saves).toHaveLength(2))
    expect(content).toBeChecked()
    expect(agent).not.toBeChecked()
    await act(() => saves[1]!.complete(true))
    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(content).toBeChecked()
    expect(agent).toBeChecked()
    expect(screen.getByRole('alert')).toHaveTextContent('Policy unavailable')
    expect(writes).toHaveLength(1)
    await user.click(agent)
    await waitFor(() => expect(saves).toHaveLength(3))
    await act(() => saves[2]!.complete())
    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(agent).not.toBeChecked()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('retries Workflow capabilities without blocking capture policy changes', async () => {
    const writes = mockServer()
    const server = request.getMockImplementation()!
    let failCapabilities = true
    request.mockImplementation(async (...args) => {
      if (failCapabilities && new URL(args[2].request.url).pathname.endsWith('/trace-capabilities'))
        throw new Error('Capabilities unavailable')
      return server(...args)
    })
    const { client } = renderPanel({ mode: 'workflow' })
    const user = await openConfiguredPanel()
    await expandCapture(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('app.tracing.capabilitiesLoadFailed')
    await user.click(screen.getByRole('switch', { name: 'app.tracing.captureContent' }))
    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(writes).toHaveLength(1)
    failCapabilities = false
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(
      await screen.findByRole('button', { name: /app\.tracing\.capabilities/ }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps Workflow capture settings collapsed until they are opened', async () => {
    mockServer()
    renderPanel({ mode: 'workflow' })
    await openConfiguredPanel()
    expect(await screen.findByRole('button', { name: 'app.tracing.captureTitle' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(
      screen.queryByRole('switch', { name: 'app.tracing.captureContent' }),
    ).not.toBeInTheDocument()
  })

  it('requests the selected provider capabilities once the user aims at the trigger', async () => {
    mockServer()
    renderPanel({ mode: 'workflow' })
    const user = userEvent.setup()
    const trigger = await screen.findByRole('button', { name: /app\.tracing\.enabled/ })
    await waitFor(() => expect(trigger).toBeEnabled())
    expect(requested('/trace-capabilities')).toEqual([])

    await user.hover(trigger)
    await waitFor(() => expect(requested('/trace-capabilities')).toHaveLength(1))
    await user.click(trigger)

    expect(
      await within(screen.getByRole('group', { name: 'app.tracing.langfuse.title' })).findByRole(
        'button',
        { name: /app\.tracing\.capabilities/ },
      ),
    ).toBeInTheDocument()
    expect(requested('/trace-capabilities')).toHaveLength(1)
  })

  it('does not request capabilities on hover for apps outside the Agent trace pipeline', async () => {
    mockServer()
    renderPanel()
    const trigger = await screen.findByRole('button', { name: /app\.tracing\.enabled/ })
    await waitFor(() => expect(trigger).toBeEnabled())
    await userEvent.setup().hover(trigger)
    expect(requested('/trace-capabilities')).toEqual([])
  })

  it('keeps provider capabilities collapsed behind a summary on the selected provider', async () => {
    mockServer()
    renderPanel({ mode: 'workflow' })
    const user = await openConfiguredPanel()
    const card = within(screen.getByRole('group', { name: 'app.tracing.langfuse.title' }))
    const disclosure = await card.findByRole('button', { name: /app\.tracing\.capabilities/ })
    expect(disclosure).toHaveAccessibleName(
      'app.tracing.capabilities app.tracing.capabilitySummary.unsupported:{"count":1}',
    )
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('app.tracing.capability.span_url')).not.toBeInTheDocument()

    await user.click(disclosure)

    expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    expect(card.getByText('app.tracing.capability.span_url').nextElementSibling).toHaveTextContent(
      'app.tracing.unsupported',
    )
    expect(screen.queryByText(/app\.tracing\.agentSpansUnsupported/)).not.toBeInTheDocument()
  })

  it('warns on the selected provider card when it cannot export full Agent traces', async () => {
    mockServer()
    const server = request.getMockImplementation()!
    request.mockImplementation(async (...args) => {
      if (new URL(args[2].request.url).pathname.endsWith('/trace-capabilities'))
        return Response.json({ ...capabilities, agent_spans: false })
      return server(...args)
    })
    renderPanel({ mode: 'workflow' })
    await openConfiguredPanel()

    expect(
      await within(screen.getByRole('group', { name: 'app.tracing.langfuse.title' })).findByText(
        'app.tracing.agentSpansUnsupported:{"provider":"app.tracing.langfuse.title"}',
      ),
    ).toBeInTheDocument()
  })

  it('replaces Agent capture settings and provider support with one note when Agent tracing is unavailable', async () => {
    agentTracingEnabled = false
    mockServer()
    renderPanel({ mode: 'workflow' })
    await openConfiguredPanel()

    expect(await screen.findByRole('note')).toHaveTextContent('app.tracing.agentTracingUnavailable')
    expect(
      screen.queryByRole('button', { name: 'app.tracing.captureTitle' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /app\.tracing\.capabilities/ }),
    ).not.toBeInTheDocument()
    expect(requested('/trace-capabilities')).toEqual([])
  })

  it.each([true, false])(
    'shows deployment availability before a provider is selected (Agent tracing enabled: %s)',
    async (enabled) => {
      agentTracingEnabled = enabled
      mockServer(false)
      renderPanel({ searchParams: 'tracing=configure', mode: 'workflow' })
      expect(
        await screen.findByRole('group', { name: 'app.tracing.langfuse.title' }),
      ).toBeInTheDocument()
      if (enabled) expect(screen.queryByRole('note')).not.toBeInTheDocument()
      else expect(screen.getByRole('note')).toHaveTextContent('app.tracing.agentTracingUnavailable')
      expect(
        screen.queryByRole('button', { name: 'app.tracing.captureTitle' }),
      ).not.toBeInTheDocument()
      expect(requested('/trace-capabilities')).toEqual([])
    },
  )

  it('shows a loading placeholder instead of an unconfigured trigger before status is known', () => {
    request.mockImplementation(() => new Promise<Response>(() => {}))
    renderPanel()
    expect(screen.getByRole('status', { name: 'app.tracing.title' })).toHaveTextContent(
      'common.loading',
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers retry when tracing cannot load instead of remaining in a loading state', async () => {
    const user = userEvent.setup()
    request.mockRejectedValue(new Error('Tracing unavailable'))
    renderPanel()
    const retry = await screen.findByRole('button', { name: /common.errorBoundary.tryAgain/ })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    mockServer(false)
    await user.click(retry)
    expect(await screen.findByText('app.tracing.title')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /common.errorBoundary.tryAgain/ }),
    ).not.toBeInTheDocument()
  })

  it('keeps the loading placeholder until configs are ready, then shows an enabled trigger', async () => {
    mockServer()
    const server = request.getMockImplementation()!
    const configsReady = createDeferred()
    request.mockImplementation(async (...args) => {
      if (new URL(args[2].request.url).pathname.endsWith('/trace-config'))
        await configsReady.promise
      return server(...args)
    })
    const { client } = renderPanel()
    await waitFor(() =>
      expect(
        client.getQueryData(
          consoleQuery.apps.byAppId.trace.get.queryKey({ input: { params: { app_id: 'app-1' } } }),
        ),
      ).toEqual({ enabled: true, tracing_provider: 'langfuse' }),
    )
    expect(screen.getByRole('status', { name: 'app.tracing.title' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    await act(async () => configsReady.resolve())
    expect(await screen.findByRole('button', { name: 'app.tracing.enabled' })).toBeEnabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('waits for saved configs when no provider is selected instead of claiming tracing is unconfigured', async () => {
    mockServer()
    const server = request.getMockImplementation()!
    let resolveConfigs!: () => void
    const configsReady = new Promise<void>((resolve) => {
      resolveConfigs = resolve
    })
    request.mockImplementation(async (...args) => {
      if (new URL(args[2].request.url).pathname.endsWith('/trace'))
        return Response.json({ enabled: false, tracing_provider: null })
      await configsReady
      return server(...args)
    })
    const { client } = renderPanel()
    await waitFor(() =>
      expect(
        client.getQueryData(
          consoleQuery.apps.byAppId.trace.get.queryKey({ input: { params: { app_id: 'app-1' } } }),
        ),
      ).toEqual({ enabled: false, tracing_provider: null }),
    )
    expect(screen.getByRole('status', { name: 'app.tracing.title' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    resolveConfigs()
    expect(await screen.findByRole('button', { name: 'app.tracing.disabled' })).toBeEnabled()
  })

  it('keeps healthy providers usable and retries only the unavailable provider', async () => {
    const writes = mockServer()
    const server = request.getMockImplementation()!
    let unavailable = true
    const retryReady = createDeferred()
    request.mockImplementation(async (...args) => {
      const url = new URL(args[2].request.url)
      if (url.searchParams.get('tracing_provider') === 'langsmith')
        return Response.json({ tracing_config: { api_key: 'key', project: 'project' } })
      if (url.searchParams.get('tracing_provider') === 'phoenix') {
        if (unavailable)
          return Response.json(
            { code: 'tracing_provider_unavailable', message: 'Unavailable' },
            { status: 400 },
          )
        await retryReady.promise
      }
      return server(...args)
    })
    const { client } = renderPanel()
    await waitFor(() => expect(client.isFetching()).toBe(0))
    const user = await openConfiguredPanel()
    const phoenix = within(screen.getByRole('group', { name: 'app.tracing.phoenix.title' }))
    expect(phoenix.queryByRole('button', { name: 'app.tracing.config' })).not.toBeInTheDocument()
    expect(
      phoenix.queryByRole('button', { name: 'app.tracing.phoenix.title' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('switch'))
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeChecked())
    expect(writes).toEqual([
      {
        method: 'POST',
        body: {
          capture_agent: true,
          capture_content: false,
          enabled: false,
          tracing_provider: 'langfuse',
        },
      },
    ])
    await user.click(screen.getByRole('button', { name: 'app.tracing.langsmith.title' }))
    await waitFor(() => expect(screen.getByRole('switch')).toBeChecked())
    expect(writes[1]).toEqual({
      method: 'POST',
      body: {
        capture_agent: true,
        capture_content: false,
        enabled: true,
        tracing_provider: 'langsmith',
      },
    })

    request.mockClear()
    unavailable = false
    await user.click(phoenix.getByRole('button', { name: 'common.errorBoundary.tryAgain' }))
    expect(phoenix.getByRole('button', { name: 'common.errorBoundary.tryAgain' })).toBeDisabled()
    expect(phoenix.queryByRole('button', { name: 'app.tracing.config' })).not.toBeInTheDocument()
    expect(screen.getByRole('switch')).not.toHaveAttribute('aria-disabled', 'true')
    await act(async () => retryReady.resolve())
    expect(await phoenix.findByRole('button', { name: 'app.tracing.config' })).toBeEnabled()
    expect(request).toHaveBeenCalledTimes(1)
    expect(
      new URL(request.mock.calls[0]![2].request.url).searchParams.get('tracing_provider'),
    ).toBe('phoenix')
  })

  it('allows disabling tracing when its active provider configuration is unavailable', async () => {
    const writes = mockServer()
    const server = request.getMockImplementation()!
    request.mockImplementation(async (...args) => {
      if (new URL(args[2].request.url).searchParams.get('tracing_provider') === 'langfuse')
        return Response.json(
          { code: 'tracing_provider_unavailable', message: 'Unavailable' },
          { status: 400 },
        )
      return server(...args)
    })
    const { client } = renderPanel()
    await waitFor(() => expect(client.isFetching()).toBe(0))
    const user = await openConfiguredPanel()
    await user.click(screen.getByRole('switch'))
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeChecked())
    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('switch'))
    expect(writes).toEqual([
      {
        method: 'POST',
        body: {
          capture_agent: true,
          capture_content: false,
          enabled: false,
          tracing_provider: 'langfuse',
        },
      },
    ])
  })

  it('shows one entry and requires a provider selection when saved configs have no active provider', async () => {
    const writes = mockServer(true, { enabled: false, tracing_provider: null })
    const { client } = renderPanel()
    await waitFor(() => expect(client.isFetching()).toBe(0))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button'))
    const tracingSwitch = screen.getByRole('switch', { name: 'app.tracing.tracing' })
    expect(tracingSwitch).toHaveAttribute('aria-disabled', 'true')
    expect(tracingSwitch).toHaveAccessibleDescription('app.tracing.disabledTip')
    await user.click(tracingSwitch)
    expect(writes).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'app.tracing.langfuse.title' }))
    await waitFor(() => expect(screen.getByRole('switch')).toBeChecked())
    expect(writes).toEqual([
      {
        method: 'POST',
        body: {
          capture_agent: true,
          capture_content: false,
          enabled: true,
          tracing_provider: 'langfuse',
        },
      },
    ])
  })

  it('hides configuration for a read-only app with no providers', async () => {
    mockServer(false)
    const { client } = renderPanel({ readOnly: true })
    await waitFor(() => expect(client.isFetching()).toBe(0))
    expect(screen.queryByText('app.tracing.title')).not.toBeInTheDocument()
  })

  it('lets a read-only user inspect configured tracing without editing it', async () => {
    mockServer()
    renderPanel({ readOnly: true })
    await openConfiguredPanel()
    expect(screen.getByRole('dialog', { name: 'app.tracing.tracing' })).toHaveAccessibleDescription(
      'app.tracing.tracingDescription',
    )
    expect(screen.getByRole('group', { name: 'app.tracing.langfuse.title' })).toBeInTheDocument()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-readonly', 'true')
    expect(screen.getByRole('switch')).toHaveAccessibleDescription('app.tracing.readOnly')
    expect(screen.queryByText('app.tracing.config')).not.toBeInTheDocument()
  })

  it('opens configuration without selecting the provider and supports keyboard selection', async () => {
    const writes = mockServer(true, { enabled: true, tracing_provider: 'langsmith' })
    renderPanel()
    const user = await openConfiguredPanel()
    const provider = within(screen.getByRole('group', { name: 'app.tracing.langfuse.title' }))
    await user.click(provider.getByRole('button', { name: 'app.tracing.config' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() =>
      expect(provider.getByRole('button', { name: 'app.tracing.config' })).toHaveFocus(),
    )
    expect(writes).toEqual([])

    await user.tab({ shift: true })
    expect(provider.getByRole('button', { name: 'app.tracing.langfuse.title' })).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(writes).toEqual([
        {
          method: 'POST',
          body: {
            capture_agent: true,
            capture_content: false,
            enabled: true,
            tracing_provider: 'langfuse',
          },
        },
      ]),
    )
  })

  it('keeps the provider list open and discards the cancelled form draft', async () => {
    mockServer(false)
    renderPanel()
    const user = userEvent.setup()
    const trigger = await screen.findByRole('button', { name: 'app.tracing.title' })
    await waitFor(() => expect(trigger).toBeEnabled())
    await user.click(trigger)
    const provider = within(screen.getByRole('group', { name: 'app.tracing.langfuse.title' }))
    await user.click(provider.getByRole('button', { name: 'app.tracing.config' }))
    await user.type(screen.getByRole('textbox', { name: 'Host' }), 'https://draft.langfuse.com')
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() =>
      expect(provider.getByRole('button', { name: 'app.tracing.config' })).toHaveFocus(),
    )
    expect(screen.getByRole('dialog', { name: 'app.tracing.tracing' })).toBeInTheDocument()
    await user.click(provider.getByRole('button', { name: 'app.tracing.config' }))
    expect(screen.getByRole('textbox', { name: 'Host' })).toHaveValue('')
  })

  it('saves and enables a new provider in one request', async () => {
    const writes = mockServer(false)
    renderPanel()
    const user = userEvent.setup()
    const trigger = await screen.findByRole('button', { name: 'app.tracing.title' })
    await waitFor(() => expect(trigger).toBeEnabled())
    await user.click(trigger)
    await user.click(screen.getAllByText('app.tracing.config')[0]!)
    await user.type(
      screen.getByRole('textbox', { name: 'app.tracing.configProvider.publicKey' }),
      'public-key',
    )
    await user.type(
      screen.getByRole('textbox', { name: 'app.tracing.configProvider.secretKey' }),
      'secret-key',
    )
    await user.type(screen.getByRole('textbox', { name: 'Host' }), 'https://cloud.langfuse.com')
    await user.click(screen.getByRole('button', { name: 'common.operation.saveAndEnable' }))
    await waitFor(() =>
      expect(writes).toEqual([
        {
          method: 'POST',
          body: {
            tracing_provider: 'langfuse',
            tracing_config: { ...langfuseConfig, secret_key: 'secret-key' },
            activate: true,
          },
        },
      ]),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /app.tracing.configProvider.title/ }),
      ).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('switch')).toBeChecked()
    await waitFor(() =>
      expect(
        within(screen.getByRole('group', { name: 'app.tracing.langfuse.title' })).getByRole(
          'button',
          { name: 'app.tracing.config' },
        ),
      ).toHaveFocus(),
    )
  })

  it('reopens an edited provider from the refreshed masked config', async () => {
    const writes = mockServer()
    const { client } = renderPanel()
    const user = await openConfiguredPanel()
    await user.click(screen.getAllByText('app.tracing.config')[0]!)
    const secret = screen.getByRole('textbox', { name: 'app.tracing.configProvider.secretKey' })
    await user.clear(secret)
    await user.type(secret, 'new-secret')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'common.operation.save' }),
      ).not.toBeInTheDocument(),
    )
    await waitFor(() => expect(client.isFetching()).toBe(0))
    await user.click(screen.getAllByText('app.tracing.config')[0]!)
    expect(
      screen.getByRole('textbox', { name: 'app.tracing.configProvider.secretKey' }),
    ).toHaveValue('[__MASKED__]')
    expect(writes).toEqual([
      {
        method: 'PATCH',
        body: {
          tracing_provider: 'langfuse',
          tracing_config: { ...langfuseConfig, secret_key: 'new-secret' },
        },
      },
    ])
  })

  it('deletes the selected provider and refreshes disabled tracing in one request', async () => {
    const writes = mockServer()
    renderPanel()
    const user = await openConfiguredPanel()
    await user.click(screen.getAllByText('app.tracing.config')[0]!)
    await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'common.operation.remove',
      }),
    )
    await waitFor(() => expect(writes).toEqual([{ method: 'DELETE', body: null }]))
    expect(await screen.findByText('app.tracing.title')).toBeInTheDocument()
    await waitFor(() =>
      expect(
        within(screen.getByRole('group', { name: 'app.tracing.langfuse.title' })).getByRole(
          'button',
          { name: 'app.tracing.config' },
        ),
      ).toHaveFocus(),
    )
  })

  it('keeps the provider form open while a save is in flight, then closes it on success', async () => {
    mockServer(false)
    const server = request.getMockImplementation()!
    let releaseSave!: () => void
    const saveHeld = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    request.mockImplementation(async (...args) => {
      const sent = args[2].request
      if (sent.method === 'POST' && new URL(sent.url).pathname.endsWith('/trace-config'))
        await saveHeld
      return server(...args)
    })
    renderPanel()
    const user = userEvent.setup()
    const trigger = await screen.findByRole('button', { name: 'app.tracing.title' })
    await waitFor(() => expect(trigger).toBeEnabled())
    await user.click(trigger)
    await user.click(screen.getAllByText('app.tracing.config')[0]!)
    await user.type(
      screen.getByRole('textbox', { name: 'app.tracing.configProvider.publicKey' }),
      'public-key',
    )
    await user.type(
      screen.getByRole('textbox', { name: 'app.tracing.configProvider.secretKey' }),
      'secret-key',
    )
    await user.type(screen.getByRole('textbox', { name: 'Host' }), 'https://cloud.langfuse.com')
    await user.click(screen.getByRole('button', { name: 'common.operation.saveAndEnable' }))

    const form = screen.getByRole('dialog', { name: /app.tracing.configProvider.title/ })
    await waitFor(() =>
      expect(within(form).getByRole('button', { name: 'common.operation.close' })).toBeDisabled(),
    )
    expect(within(form).getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(form).toBeInTheDocument()

    releaseSave()
    await waitFor(() => expect(form).not.toBeInTheDocument())
  })

  it('keeps the removal confirmation open until the deletion settles', async () => {
    mockServer()
    const server = request.getMockImplementation()!
    let releaseDelete!: () => void
    const deleteHeld = new Promise<void>((resolve) => {
      releaseDelete = resolve
    })
    request.mockImplementation(async (...args) => {
      if (args[2].request.method === 'DELETE') await deleteHeld
      return server(...args)
    })
    renderPanel()
    const user = await openConfiguredPanel()
    await user.click(screen.getAllByText('app.tracing.config')[0]!)
    await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    const confirmation = screen.getByRole('alertdialog')
    await user.click(within(confirmation).getByRole('button', { name: 'common.operation.remove' }))

    await waitFor(() =>
      expect(
        within(confirmation).getByRole('button', { name: 'common.operation.cancel' }),
      ).toBeDisabled(),
    )
    await user.keyboard('{Escape}')
    expect(confirmation).toBeInTheDocument()

    releaseDelete()
    await waitFor(() => expect(confirmation).not.toBeInTheDocument())
  })

  it('opens from the tracing URL destination once ready and clears it on close', async () => {
    mockServer()
    const { onUrlUpdate } = renderPanel({ searchParams: '?tracing=configure' })
    expect(await screen.findByText('app.tracing.tracing')).toBeInTheDocument()

    await userEvent.setup().keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByText('app.tracing.tracing')).not.toBeInTheDocument())
    expect(onUrlUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ queryString: '' }))
    expect(screen.getByRole('button', { name: /app\.tracing\.enabled/ })).toHaveFocus()
  })

  it('records the open configuration in the URL when opened from its trigger', async () => {
    mockServer()
    const { onUrlUpdate } = renderPanel()
    await openConfiguredPanel()
    expect(onUrlUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ queryString: '?tracing=configure' }),
    )
  })

  it('does not carry a pending policy change or its failure into another app', async () => {
    mockServer()
    const server = request.getMockImplementation()!
    const save = createDeferred<Response>()
    request.mockImplementation(async (...args) => {
      if (args[2].request.method === 'POST') return save.promise
      return server(...args)
    })
    const { rerender } = renderPanel()
    const user = await openConfiguredPanel()
    await user.click(screen.getByRole('switch', { name: 'app.tracing.tracing' }))
    expect(screen.getByRole('switch', { name: 'app.tracing.tracing' })).not.toBeChecked()
    await waitFor(() =>
      expect(request.mock.calls.some(([, , { request: sent }]) => sent.method === 'POST')).toBe(
        true,
      ),
    )

    rerender(<Panel resource={{ kind: 'app', appId: 'app-2', mode: 'chat' }} readOnly={false} />)
    expect(await screen.findByRole('switch', { name: 'app.tracing.tracing' })).toBeChecked()
    await act(async () => {
      save.reject(
        await httpErrorFromResponse(
          Response.json({ code: 'save_failed', message: 'App 1 save failed' }, { status: 500 }),
        ),
      )
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'app.tracing.tracing' })).toBeChecked()

    rerender(<Panel resource={{ kind: 'app', appId: 'app-1', mode: 'chat' }} readOnly={false} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('App 1 save failed')
    expect(screen.getByRole('switch', { name: 'app.tracing.tracing' })).toBeChecked()
    expect(
      request.mock.calls
        .filter(([, , { request: sent }]) => sent.method === 'POST')
        .map(([, , { request: sent }]) => new URL(sent.url).pathname),
    ).toEqual([expect.stringMatching(/\/apps\/app-1\/trace$/)])
  })

  it('refreshes a concurrently removed provider after a selection conflict and lets the user retry', async () => {
    const writes = mockServer()
    const server = request.getMockImplementation()!
    let removed = false
    request.mockImplementation(async (...args) => {
      const sent = args[2].request
      const url = new URL(sent.url)
      if (sent.method === 'POST' && url.pathname.endsWith('/trace') && !removed) {
        removed = true
        throw await httpErrorFromResponse(
          Response.json(
            {
              code: 'tracing_config_conflict',
              message: 'Provider was removed. Choose another provider.',
            },
            { status: 409 },
          ),
        )
      }
      if (
        sent.method === 'GET' &&
        url.pathname.endsWith('/trace-config') &&
        url.searchParams.get('tracing_provider') === 'langsmith'
      ) {
        return Response.json({
          has_not_configured: removed,
          tracing_config: removed ? null : { api_key: '[__MASKED__]', project: 'project' },
        })
      }
      return server(...args)
    })
    renderPanel()
    const user = await openConfiguredPanel()
    await user.click(screen.getByRole('button', { name: 'app.tracing.langsmith.title' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Provider was removed')
    const provider = within(screen.getByRole('group', { name: 'app.tracing.langsmith.title' }))
    await waitFor(() =>
      expect(
        provider.queryByRole('button', {
          name: 'app.tracing.langsmith.title',
        }),
      ).not.toBeInTheDocument(),
    )
    expect(provider.getByRole('button', { name: 'app.tracing.config' })).toBeEnabled()
    expect(screen.getByRole('switch', { name: 'app.tracing.tracing' })).toBeChecked()

    await user.click(screen.getByRole('switch', { name: 'app.tracing.tracing' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getByRole('switch', { name: 'app.tracing.tracing' })).not.toBeChecked()
    expect(writes).toEqual([
      {
        method: 'POST',
        body: {
          enabled: false,
          tracing_provider: 'langfuse',
          capture_content: false,
          capture_agent: true,
        },
      },
    ])
  })

  it('keeps an open draft across config refreshes and starts a new session for another app', async () => {
    mockServer()
    const { client, rerender } = renderPanel()
    const user = await openConfiguredPanel()
    await user.click(screen.getAllByText('app.tracing.config')[0]!)
    const host = screen.getByRole('textbox', { name: 'Host' })
    await user.clear(host)
    await user.type(host, 'https://draft.langfuse.com')
    act(() =>
      client.setQueryData(
        consoleQuery.apps.byAppId.traceConfig.get.queryKey({
          input: { params: { app_id: 'app-1' }, query: { tracing_provider: 'langfuse' } },
        }),
        { tracing_config: { ...langfuseConfig, host: 'https://server.langfuse.com' } },
      ),
    )
    expect(host).toHaveValue('https://draft.langfuse.com')
    rerender(<Panel resource={{ kind: 'app', appId: 'app-2', mode: 'chat' }} readOnly={false} />)
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Host' })).not.toBeInTheDocument(),
    )
    // The URL destination still asks for configuration, so the new app's popover reopens once ready.
    await user.click(screen.getAllByText('app.tracing.config')[0]!)
    expect(screen.getByRole('textbox', { name: 'Host' })).toHaveValue(langfuseConfig.host)
  })
})
