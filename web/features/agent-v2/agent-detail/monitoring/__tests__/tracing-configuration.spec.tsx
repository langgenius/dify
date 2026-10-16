import type {
  AppTraceResponse,
  TraceProviderCapabilitiesResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentPermission } from '@/features/agent-v2/acl'
import { consoleQuery } from '@/service/console'
import { httpErrorFromResponse } from '@/service/http-error'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createAgentFixture } from '@/test/fixtures/agent'
import { AgentTracingConfiguration } from '../tracing-configuration'

const request = vi.hoisted(() =>
  vi.fn<(url: string, init: RequestInit, options: { request: Request }) => Promise<Response>>(),
)
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request,
}))

const langfuse = {
  public_key: 'public',
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
  api_collection_enabled: false,
  export_ack: 'accepted',
}

function setup({
  permissions = [AgentPermission.Monitor, AgentPermission.Edit] as string[],
  configured = true,
} = {}) {
  const { wrapper, queryClient } = createConsoleQueryWrapper({
    systemFeatures: { rbac_enabled: true },
  })
  const detailKey = consoleQuery.agent.byAgentId.get.queryKey({
    input: { params: { agent_id: 'agent-1' } },
  })
  queryClient.setQueryData(
    detailKey,
    createAgentFixture({ id: 'agent-1', permission_keys: permissions }),
  )
  const state = {
    policy: {
      enabled: configured,
      tracing_provider: configured ? 'langfuse' : null,
      capture_content: false,
      capture_agent: true,
    } satisfies AppTraceResponse,
    config: configured ? langfuse : null,
    failPolicy: false,
    failDelete: false,
    failCapabilities: false,
    capabilities: { ...capabilities },
  }
  const sent: Request[] = []
  request.mockImplementation(async (_url, _init, { request: req }) => {
    sent.push(req.clone())
    const url = new URL(req.url)
    if (url.pathname.endsWith('/agent/agent-1'))
      return Response.json(createAgentFixture({ id: 'agent-1', permission_keys: permissions }))
    if (url.pathname.endsWith('/trace')) {
      if (req.method === 'POST') {
        if (state.failPolicy)
          throw await httpErrorFromResponse(
            Response.json(
              { code: 'invalid_param', message: 'Policy unavailable' },
              { status: 400 },
            ),
          )
        state.policy = await req.json()
      }
      return Response.json(state.policy)
    }
    if (url.pathname.endsWith('/trace-capabilities')) {
      if (state.failCapabilities)
        throw await httpErrorFromResponse(
          Response.json(
            { code: 'tracing_provider_unavailable', message: 'Capabilities unavailable' },
            { status: 400 },
          ),
        )
      return Response.json(state.capabilities)
    }
    if (url.pathname.endsWith('/trace-config')) {
      if (req.method === 'GET') {
        const config = url.searchParams.get('tracing_provider') === 'langfuse' ? state.config : null
        return Response.json({ tracing_config: config, has_not_configured: !config })
      }
      if (req.method === 'DELETE') {
        if (state.failDelete)
          throw await httpErrorFromResponse(
            Response.json(
              { code: 'invalid_param', message: 'Delete unavailable' },
              { status: 400 },
            ),
          )
        state.config = null
        return new Response(null, { status: 204 })
      }
      const body = await req.json()
      state.config = { ...body.tracing_config, secret_key: '[__MASKED__]' }
      return Response.json({ result: 'success' }, { status: req.method === 'POST' ? 201 : 200 })
    }
    throw new Error(`Unexpected request ${req.method} ${url.pathname}`)
  })
  const view = render(<AgentTracingConfiguration agentId="agent-1" />, { wrapper })
  return { ...view, state, sent, queryClient, detailKey }
}

async function openPanel(configured = true) {
  const user = userEvent.setup()
  const trigger = await screen.findByRole('button', {
    name: configured ? /app.tracing.enabled/ : 'app.tracing.title',
  })
  await waitFor(() => expect(trigger).toBeEnabled())
  await user.click(trigger)
  return user
}
async function openProvider(user: ReturnType<typeof userEvent.setup>) {
  const group = within(screen.getByRole('group', { name: 'app.tracing.langfuse.title' }))
  await user.click(group.getByRole('button', { name: 'app.tracing.config' }))
}
const writes = (sent: Request[]) => sent.filter((req) => req.method !== 'GET')

describe('Agent tracing configuration', () => {
  it.each([[], [AgentPermission.Edit], [AgentPermission.LogManage]])(
    'does not expose tracing without Monitor permission: %j',
    async (...permissionKeys) => {
      const { sent, queryClient } = setup({ permissions: permissionKeys.flat() })
      await waitFor(() => expect(queryClient.isFetching()).toBe(0))
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      expect(sent.some((req) => new URL(req.url).pathname.includes('/trace'))).toBe(false)
    },
  )

  it('shows policy and capabilities to Monitor-only users without requesting credentials', async () => {
    const { sent } = setup({ permissions: [AgentPermission.Monitor] })
    await openPanel()
    expect(await screen.findByText('app.tracing.apiCollectionDisabled')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'app.tracing.captureContent' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('switch', { name: 'app.tracing.captureAgent' })).toBeChecked()
    expect(screen.queryByRole('button', { name: 'app.tracing.config' })).not.toBeInTheDocument()
    expect(sent.some((req) => new URL(req.url).pathname.endsWith('/trace-config'))).toBe(false)
    expect(writes(sent)).toHaveLength(0)
  })

  it('preserves all policy fields when changing capture flags and refreshing', async () => {
    const { sent, state, queryClient } = setup()
    const user = await openPanel()
    await user.click(screen.getByRole('switch', { name: 'app.tracing.captureContent' }))
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'app.tracing.captureContent' })).toBeChecked(),
    )
    expect(await writes(sent)[0]!.json()).toEqual({
      enabled: true,
      tracing_provider: 'langfuse',
      capture_content: true,
      capture_agent: true,
    })
    await user.click(screen.getByRole('switch', { name: 'app.tracing.captureAgent' }))
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'app.tracing.captureAgent' })).not.toBeChecked(),
    )
    expect(state.policy).toEqual({
      enabled: true,
      tracing_provider: 'langfuse',
      capture_content: true,
      capture_agent: false,
    })
    await act(() =>
      queryClient.invalidateQueries({ queryKey: consoleQuery.agent.byAgentId.trace.get.key() }),
    )
    expect(screen.getByRole('switch', { name: 'app.tracing.captureContent' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'app.tracing.captureAgent' })).not.toBeChecked()
    expect(sent.every((req) => new URL(req.url).pathname.includes('/agent/agent-1/'))).toBe(true)
  })

  it('keeps saved credentials and retries only enable after a partial success', async () => {
    const { state, sent } = setup({ configured: false })
    const user = await openPanel(false)
    await openProvider(user)
    await user.type(
      screen.getByRole('textbox', { name: 'app.tracing.configProvider.publicKey' }),
      'public',
    )
    await user.type(
      screen.getByRole('textbox', { name: 'app.tracing.configProvider.secretKey' }),
      'secret',
    )
    await user.type(screen.getByRole('textbox', { name: 'Host' }), 'https://cloud.langfuse.com')
    state.failPolicy = true
    await user.click(screen.getByRole('button', { name: 'common.operation.saveAndEnable' }))
    expect(
      await screen.findByText('app.tracing.configurationSavedEnableFailed'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('dialog', { name: /app.tracing.configProvider.title/ }),
    ).toBeInTheDocument()
    state.failPolicy = false
    await user.click(screen.getByRole('button', { name: 'app.tracing.retryEnable' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /app.tracing.configProvider.title/ }),
      ).not.toBeInTheDocument(),
    )
    expect(
      writes(sent).map((req) => `${req.method} ${new URL(req.url).pathname.split('/').at(-1)}`),
    ).toEqual(['POST trace-config', 'POST trace', 'POST trace'])
    expect(state.policy.enabled).toBe(true)
    expect(state.config?.secret_key).toBe('[__MASKED__]')
  })

  it('does not delete the selected provider when disabling fails, then disables before deleting', async () => {
    const { state, sent } = setup()
    const user = await openPanel()
    await openProvider(user)
    state.failPolicy = true
    await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    const dialog = within(screen.getByRole('alertdialog'))
    expect(await dialog.findByRole('alert')).toHaveTextContent('Policy unavailable')
    expect(writes(sent).map((req) => req.method)).toEqual(['POST'])
    state.failPolicy = false
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() => expect(state.config).toBeNull())
    expect(writes(sent).map((req) => req.method)).toEqual(['POST', 'POST', 'DELETE'])
    expect(state.policy).toEqual({
      enabled: false,
      tracing_provider: null,
      capture_content: false,
      capture_agent: true,
    })
  })

  it('refreshes capabilities after updating masked credentials without claiming runtime health', async () => {
    const { state, sent } = setup()
    const user = await openPanel()
    await screen.findByText('app.tracing.apiCollectionDisabled')
    await openProvider(user)
    state.capabilities.api_collection_enabled = true
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(await screen.findByText('app.tracing.runtimeUnverified')).toBeInTheDocument()
    const patch = writes(sent).find((req) => req.method === 'PATCH')!
    expect(await patch.json()).toEqual({ tracing_provider: 'langfuse', tracing_config: langfuse })
    expect(
      sent.filter((req) => new URL(req.url).pathname.endsWith('/trace-capabilities')).length,
    ).toBeGreaterThan(1)
  })

  it('retries capabilities independently without blocking configuration', async () => {
    const { state } = setup()
    state.failCapabilities = true
    const user = await openPanel()
    expect(await screen.findByRole('alert')).toHaveTextContent('Capabilities unavailable')
    expect(
      within(screen.getByRole('group', { name: 'app.tracing.langfuse.title' })).getByRole(
        'button',
        { name: 'app.tracing.config' },
      ),
    ).toBeEnabled()
    state.failCapabilities = false
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(await screen.findByText('app.tracing.apiCollectionDisabled')).toBeInTheDocument()
  })

  it('closes credential editing when Edit permission is revoked', async () => {
    const { queryClient, detailKey } = setup()
    const user = await openPanel()
    await openProvider(user)
    act(() =>
      queryClient.setQueryData(
        detailKey,
        createAgentFixture({ permission_keys: [AgentPermission.Monitor] }),
      ),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /app.tracing.configProvider.title/ }),
      ).not.toBeInTheDocument(),
    )
    expect(screen.queryByRole('button', { name: 'app.tracing.config' })).not.toBeInTheDocument()
  })
})
