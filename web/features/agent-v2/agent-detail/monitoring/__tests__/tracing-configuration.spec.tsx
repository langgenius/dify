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
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
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
  api_collection_enabled: true,
  export_ack: 'accepted',
}

function setup({
  permissions = [AgentPermission.Monitor, AgentPermission.Edit] as string[],
  configured = true,
} = {}) {
  const { wrapper: QueryWrapper, queryClient } = createConsoleQueryWrapper({
    systemFeatures: { rbac_enabled: true },
    features: { agent_tracing_api_collection_enabled: true },
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
    failConfig: false,
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
        state.policy = { ...state.policy, enabled: false, tracing_provider: null }
        return new Response(null, { status: 204 })
      }
      if (state.failConfig)
        throw await httpErrorFromResponse(
          Response.json({ code: 'invalid_param', message: 'Config rejected' }, { status: 400 }),
        )
      const body = await req.json()
      if (body.activate)
        state.policy = { ...state.policy, enabled: true, tracing_provider: body.tracing_provider }
      state.config = { ...body.tracing_config, secret_key: '[__MASKED__]' }
      return Response.json({ result: 'success' }, { status: req.method === 'POST' ? 201 : 200 })
    }
    throw new Error(`Unexpected request ${req.method} ${url.pathname}`)
  })
  const { wrapper: NuqsWrapper } = createNuqsTestWrapper({ hasMemory: true })
  const view = render(<AgentTracingConfiguration agentId="agent-1" />, {
    wrapper: ({ children }) => (
      <QueryWrapper>
        <NuqsWrapper>{children}</NuqsWrapper>
      </QueryWrapper>
    ),
  })
  return { ...view, state, sent, queryClient, detailKey }
}

async function openPanel(configured = true, { expandCapture = configured } = {}) {
  const user = userEvent.setup()
  const trigger = await screen.findByRole('button', {
    name: configured ? /app.tracing.enabled/ : 'app.tracing.title',
  })
  await waitFor(() => expect(trigger).toBeEnabled())
  await user.click(trigger)
  // Capture settings stay collapsed until opened.
  if (expandCapture)
    await user.click(await screen.findByRole('button', { name: /app\.tracing\.captureTitle/ }))
  return user
}
async function openProvider(user: ReturnType<typeof userEvent.setup>) {
  const group = within(screen.getByRole('group', { name: 'app.tracing.langfuse.title' }))
  await user.click(group.getByRole('button', { name: 'app.tracing.config' }))
}
const writes = (sent: Request[]) => sent.filter((req) => req.method !== 'GET')

function holdPolicySaves() {
  const server = request.getMockImplementation()!
  const saves: Array<{ request: Request; finish: (fail?: boolean) => void }> = []
  request.mockImplementation(async (...args) => {
    const req = args[2].request
    if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/trace')) {
      const fail = await new Promise<boolean>((resolve) => {
        saves.push({ request: req.clone(), finish: (failed = false) => resolve(failed) })
      })
      if (fail)
        throw await httpErrorFromResponse(
          Response.json({ code: 'invalid_param', message: 'Policy unavailable' }, { status: 400 }),
        )
    }
    return server(...args)
  })
  return saves
}

describe('Agent tracing configuration', () => {
  it.each(
    [[], [AgentPermission.Edit], [AgentPermission.LogManage]].map((permissions) => ({
      permissions,
    })),
  )('does not expose tracing without Monitor permission: $permissions', async ({ permissions }) => {
    const { sent, queryClient } = setup({ permissions })
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(sent.some((req) => new URL(req.url).pathname.includes('/trace'))).toBe(false)
  })

  it('shows policy and capabilities to Monitor-only users without requesting credentials', async () => {
    const { sent } = setup({ permissions: [AgentPermission.Monitor] })
    const user = await openPanel()
    expect(
      await screen.findByRole('button', { name: /app\.tracing\.capabilities/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'app.tracing.captureContent' })).toHaveAttribute(
      'aria-readonly',
      'true',
    )
    expect(screen.getByRole('switch', { name: 'app.tracing.captureAgent' })).toBeChecked()
    for (const control of screen.getAllByRole('switch')) {
      expect(control).toHaveAttribute('aria-readonly', 'true')
      await user.click(control)
      await user.keyboard(' {Enter}')
    }
    expect(screen.queryByRole('button', { name: 'app.tracing.config' })).not.toBeInTheDocument()
    expect(sent.some((req) => new URL(req.url).pathname.endsWith('/trace-config'))).toBe(false)
    expect(writes(sent)).toHaveLength(0)
  })

  it.each([false, true])(
    'keeps switches responsive and saves the latest complete configuration when the first save fails: %s',
    async (failFirst) => {
      const { state } = setup()
      const user = await openPanel()
      const saves = holdPolicySaves()
      const content = screen.getByRole('switch', { name: 'app.tracing.captureContent' })
      const agent = screen.getByRole('switch', { name: 'app.tracing.captureAgent' })
      await user.click(content)
      expect(content).toBeChecked()
      await user.click(agent)
      expect(agent).not.toBeChecked()
      for (const control of screen.getAllByRole('switch')) {
        expect(control).not.toHaveAttribute('aria-busy', 'true')
        expect(control).not.toHaveAttribute('aria-disabled', 'true')
      }
      expect(saves).toHaveLength(1)
      await act(() => saves[0]!.finish(failFirst))
      await waitFor(() => expect(saves).toHaveLength(2))
      expect(await saves[1]!.request.json()).toMatchObject({
        capture_content: true,
        capture_agent: false,
      })
      expect(agent).not.toBeChecked()
      expect(content).toBeChecked()
      await act(() => saves[1]!.finish())
      await waitFor(() => expect(state.policy.capture_agent).toBe(false))
      expect(state.policy.capture_content).toBe(true)
    },
  )

  it('keeps the latest intent when the same switch is toggled repeatedly and saves fail', async () => {
    const { state } = setup()
    const user = await openPanel()
    const saves = holdPolicySaves()
    const content = screen.getByRole('switch', { name: 'app.tracing.captureContent' })
    await user.click(content)
    await user.click(content)
    await user.click(content)
    expect(content).toBeChecked()
    await act(() => saves[0]!.finish(true))
    await waitFor(() => expect(saves).toHaveLength(2))
    expect(content).toBeChecked()
    await act(() => saves[1]!.finish())
    await waitFor(() => expect(saves).toHaveLength(3))
    expect(content).toBeChecked()
    await act(() => saves[2]!.finish(true))
    await waitFor(() => expect(content).not.toBeChecked())
    expect(state.policy.capture_content).toBe(false)
    expect(screen.getByRole('alert')).toHaveTextContent('Policy unavailable')
  })

  it('rolls back only the failed change after another setting has saved', async () => {
    const { state } = setup()
    const user = await openPanel()
    const saves = holdPolicySaves()
    const content = screen.getByRole('switch', { name: 'app.tracing.captureContent' })
    const agent = screen.getByRole('switch', { name: 'app.tracing.captureAgent' })
    await user.click(content)
    await user.click(agent)
    await act(() => saves[0]!.finish())
    await waitFor(() => expect(saves).toHaveLength(2))
    await act(() => saves[1]!.finish(true))
    await waitFor(() => expect(agent).toBeChecked())
    expect(content).toBeChecked()
    expect(state.policy).toMatchObject({ capture_content: true, capture_agent: true })
  })

  it('retains a successful save when refresh fails, then rolls back a later failed save to it', async () => {
    const { state } = setup()
    const user = await openPanel()
    const server = request.getMockImplementation()!
    request.mockImplementation(async (...args) => {
      const req = args[2].request
      if (req.method === 'GET' && new URL(req.url).pathname.endsWith('/trace'))
        throw await httpErrorFromResponse(
          Response.json({ message: 'Refresh unavailable' }, { status: 400 }),
        )
      return server(...args)
    })
    const content = screen.getByRole('switch', { name: 'app.tracing.captureContent' })
    const saves = holdPolicySaves()
    await user.click(content)
    await act(() => saves[0]!.finish())
    await waitFor(() => expect(state.policy.capture_content).toBe(true))
    await user.click(content)
    await waitFor(() => expect(saves).toHaveLength(2))
    expect(content).not.toBeChecked()
    await act(() => saves[1]!.finish(true))
    await waitFor(() => expect(content).toBeChecked())
    expect(screen.getByRole('alert')).toHaveTextContent('Policy unavailable')
  })

  it('updates the main switch and entry immediately, then rolls back a failed save', async () => {
    setup()
    const user = await openPanel()
    const saves = holdPolicySaves()
    const control = screen.getByRole('switch', { name: 'app.tracing.tracing' })
    const panel = within(screen.getByRole('dialog', { name: 'app.tracing.tracing' }))
    expect(panel.getByText('app.tracing.enabled')).toBeInTheDocument()
    await user.click(control)
    expect(control).not.toBeChecked()
    expect(panel.getByText('app.tracing.disabled')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /app.tracing.disabled/ })).toBeInTheDocument()
    await act(() => saves[0]!.finish(true))
    await waitFor(() => expect(control).toBeChecked())
    expect(panel.getByText('app.tracing.enabled')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /app.tracing.enabled/ })).toBeInTheDocument()
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

  it('keeps a failed save-and-enable draft and retries the single atomic request', async () => {
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
    const host = screen.getByRole('textbox', { name: 'Host' })
    await user.type(host, 'https://cloud.langfuse.com')
    state.failConfig = true
    await user.click(screen.getByRole('button', { name: 'common.operation.saveAndEnable' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Config rejected')
    expect(state.config).toBeNull()
    expect(state.policy.enabled).toBe(false)
    expect(host).toHaveValue('https://cloud.langfuse.com')
    expect(writes(sent)).toHaveLength(1)
    state.failConfig = false
    await user.clear(host)
    await user.type(host, 'https://updated.langfuse.com')
    await user.click(screen.getByRole('button', { name: 'common.operation.saveAndEnable' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /app.tracing.configProvider.title/ }),
      ).not.toBeInTheDocument(),
    )
    expect(
      writes(sent).map((req) => `${req.method} ${new URL(req.url).pathname.split('/').at(-1)}`),
    ).toEqual(['POST trace-config', 'POST trace-config'])
    expect(await writes(sent)[1]!.json()).toEqual({
      tracing_provider: 'langfuse',
      tracing_config: { ...langfuse, secret_key: 'secret', host: 'https://updated.langfuse.com' },
      activate: true,
    })
    expect(screen.getByRole('switch', { name: 'app.tracing.tracing' })).toBeChecked()
    expect(state.policy).toEqual({
      enabled: true,
      tracing_provider: 'langfuse',
      capture_content: false,
      capture_agent: true,
    })
    expect(state.config?.secret_key).toBe('[__MASKED__]')
  })

  it('preserves the draft after concurrent deletion and clears the conflict when retrying creation', async () => {
    const { state } = setup()
    const user = await openPanel()
    await openProvider(user)
    const host = screen.getByRole('textbox', { name: 'Host' })
    await user.clear(host)
    await user.type(host, 'https://draft.langfuse.com')
    const server = request.getMockImplementation()!
    request.mockImplementation(async (...args) => {
      if (args[2].request.method === 'PATCH') {
        state.config = null
        state.policy = { ...state.policy, enabled: false, tracing_provider: null }
        throw await httpErrorFromResponse(
          Response.json(
            {
              code: 'tracing_config_conflict',
              message: 'Tracing configuration changed. Refresh and try again.',
            },
            { status: 409 },
          ),
        )
      }
      return server(...args)
    })
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Tracing configuration changed')
    expect(host).toHaveValue('https://draft.langfuse.com')
    expect(screen.getByRole('button', { name: 'common.operation.saveAndEnable' })).toBeEnabled()
    expect(
      screen.getByRole('switch', { name: 'app.tracing.tracing', hidden: true }),
    ).not.toBeChecked()

    let finishRetry!: () => void
    const retry = new Promise<void>((resolve) => {
      finishRetry = resolve
    })
    request.mockImplementation(async (...args) => {
      if (args[2].request.method === 'POST') await retry
      return server(...args)
    })
    await user.type(
      screen.getByRole('textbox', { name: 'app.tracing.configProvider.secretKey' }),
      'secret',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.saveAndEnable' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(host).toHaveValue('https://draft.langfuse.com')
    await act(async () => finishRetry())
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /app.tracing.configProvider.title/ }),
      ).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('switch', { name: 'app.tracing.tracing' })).toBeChecked()
  })

  it('preserves tracing after failed deletion and retries deletion without a policy request', async () => {
    const { state, sent } = setup()
    const user = await openPanel()
    await openProvider(user)
    state.failDelete = true
    await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    const dialog = within(screen.getByRole('alertdialog'))
    await user.click(dialog.getByRole('button', { name: 'common.operation.remove' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent('Delete unavailable')
    expect(writes(sent).map((req) => req.method)).toEqual(['DELETE'])
    expect(state.config).toEqual(langfuse)
    expect(state.policy.enabled).toBe(true)
    state.failDelete = false
    await user.click(dialog.getByRole('button', { name: 'common.operation.remove' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(writes(sent).map((req) => req.method)).toEqual(['DELETE', 'DELETE'])
    expect(state.config).toBeNull()
    expect(screen.getByRole('switch', { name: 'app.tracing.tracing' })).not.toBeChecked()
    expect(state.policy).toEqual({
      enabled: false,
      tracing_provider: null,
      capture_content: false,
      capture_agent: true,
    })
  })

  it('refreshes capabilities after updating masked credentials', async () => {
    const { sent } = setup()
    const user = await openPanel()
    await openProvider(user)
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Host' })).not.toBeInTheDocument(),
    )
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
    expect(await screen.findByRole('alert')).toHaveTextContent('app.tracing.capabilitiesLoadFailed')
    expect(
      within(screen.getByRole('group', { name: 'app.tracing.langfuse.title' })).getByRole(
        'button',
        { name: 'app.tracing.config' },
      ),
    ).toBeEnabled()
    state.failCapabilities = false
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(
      await screen.findByRole('button', { name: /app\.tracing\.capabilities/ }),
    ).toBeInTheDocument()
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
