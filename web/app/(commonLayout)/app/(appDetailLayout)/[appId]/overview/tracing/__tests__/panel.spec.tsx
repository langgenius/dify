import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { createDeferred } from '@/test/deferred'
import { createTestQueryClient } from '@/test/query-client'
import Panel from '../panel'

const { request } = vi.hoisted(() => ({
  request:
    vi.fn<(url: string, init: RequestInit, options: { request: Request }) => Promise<Response>>(),
}))
vi.mock('@/service/base', () => ({ request }))
vi.mock('@/app/notifications', () => ({ toast: vi.fn() }))

const langfuseConfig = {
  public_key: 'public-key',
  secret_key: '[__MASKED__]',
  host: 'https://cloud.langfuse.com',
}

function mockServer(configured = true) {
  let status = { enabled: configured, tracing_provider: configured ? 'langfuse' : null }
  let config: Record<string, unknown> | null = configured ? langfuseConfig : null
  const writes: Array<{ method: string; body: unknown }> = []
  request.mockImplementation(async (_url, _init, { request: sent }) => {
    const url = new URL(sent.url)
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
      writes.push({ method: sent.method, body: null })
      return new Response(null, { status: 204 })
    }
    const body = await sent.json()
    writes.push({ method: sent.method, body })
    config = { ...body.tracing_config, secret_key: '[__MASKED__]' }
    return Response.json({ result: 'success' })
  })
  return writes
}

function renderPanel(readOnly = false) {
  const client = createTestQueryClient()
  const view = render(<Panel appId="app-1" readOnly={readOnly} />, {
    wrapper: createQueryClientWrapper(client),
  })
  return { ...view, client }
}

async function openConfiguredPanel() {
  const user = userEvent.setup()
  await user.click(await screen.findByText('app.tracing.enabled'))
  await screen.findByText('app.tracing.tracing')
  return user
}

describe('Tracing overview panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the tracing entry visible and disabled until configuration is ready', async () => {
    request.mockImplementation(() => new Promise<Response>(() => {}))
    renderPanel()
    expect(screen.getByRole('button', { name: 'app.tracing.title' })).toBeDisabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
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

  it('keeps one disabled entry when status arrives before provider configurations', async () => {
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
    expect(screen.getByRole('button')).toBeDisabled()
    await act(async () => configsReady.resolve())
    await waitFor(() => expect(screen.getByRole('button')).toBeEnabled())
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
      { method: 'POST', body: { enabled: false, tracing_provider: 'langfuse' } },
    ])
    await user.click(screen.getByRole('button', { name: 'app.tracing.langsmith.title' }))
    await waitFor(() => expect(screen.getByRole('switch')).toBeChecked())
    expect(writes[1]).toEqual({
      method: 'POST',
      body: { enabled: true, tracing_provider: 'langsmith' },
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
      { method: 'POST', body: { enabled: false, tracing_provider: 'langfuse' } },
    ])
  })

  it('shows one entry and requires a provider selection when saved configs have no active provider', async () => {
    const writes = mockServer()
    const { client } = renderPanel()
    await waitFor(() => expect(client.isFetching()).toBe(0))
    act(() =>
      client.setQueryData(
        consoleQuery.apps.byAppId.trace.get.queryKey({ input: { params: { app_id: 'app-1' } } }),
        { enabled: false, tracing_provider: null },
      ),
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button'))
    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('button', { name: 'app.tracing.langfuse.title' }))
    await waitFor(() => expect(screen.getByRole('switch')).toBeChecked())
    expect(writes).toEqual([
      { method: 'POST', body: { enabled: true, tracing_provider: 'langfuse' } },
    ])
  })

  it('hides configuration for a read-only app with no providers', async () => {
    mockServer(false)
    const { client } = renderPanel(true)
    await waitFor(() => expect(client.isFetching()).toBe(0))
    expect(screen.queryByText('app.tracing.title')).not.toBeInTheDocument()
  })

  it('lets a read-only user inspect configured tracing without editing it', async () => {
    mockServer()
    renderPanel(true)
    await openConfiguredPanel()
    expect(screen.getByText('app.tracing.langfuse.description')).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByText('app.tracing.config')).not.toBeInTheDocument()
  })

  it('opens configuration without selecting the provider and supports keyboard selection', async () => {
    const writes = mockServer()
    const { client } = renderPanel()
    await waitFor(() => expect(client.isFetching()).toBe(0))
    act(() =>
      client.setQueryData(
        consoleQuery.apps.byAppId.trace.get.queryKey({ input: { params: { app_id: 'app-1' } } }),
        { enabled: true, tracing_provider: 'langsmith' },
      ),
    )
    const user = await openConfiguredPanel()
    const provider = within(screen.getByRole('group', { name: 'app.tracing.langfuse.title' }))
    await user.click(provider.getByRole('button', { name: 'app.tracing.config' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() =>
      expect(provider.getByRole('button', { name: 'app.tracing.config' })).toHaveFocus(),
    )
    expect(writes).toEqual([])

    await user.tab({ shift: true })
    await expect(provider.getByRole('button', { name: 'app.tracing.langfuse.title' })).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(writes).toEqual([
        { method: 'POST', body: { enabled: true, tracing_provider: 'langfuse' } },
      ]),
    )
  })

  it('saves a new provider before enabling it', async () => {
    const writes = mockServer(false)
    renderPanel()
    const user = userEvent.setup()
    await user.click(await screen.findByText('app.tracing.title'))
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
          },
        },
        { method: 'POST', body: { enabled: true, tracing_provider: 'langfuse' } },
      ]),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /app.tracing.configProvider.title/ }),
      ).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('switch')).toBeChecked()
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

  it('disables tracing after deleting the last selected provider', async () => {
    const writes = mockServer()
    renderPanel()
    const user = await openConfiguredPanel()
    await user.click(screen.getAllByText('app.tracing.config')[0]!)
    await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() =>
      expect(writes).toEqual([
        { method: 'DELETE', body: null },
        { method: 'POST', body: { enabled: false, tracing_provider: null } },
      ]),
    )
    expect(await screen.findByText('app.tracing.title')).toBeInTheDocument()
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
    rerender(<Panel appId="app-2" readOnly={false} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await openConfiguredPanel()
    await user.click(screen.getAllByText('app.tracing.config')[0]!)
    expect(screen.getByRole('textbox', { name: 'Host' })).toHaveValue(langfuseConfig.host)
  })
})
