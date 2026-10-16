import type {
  AppTraceResponse,
  TraceProviderCapabilitiesResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { httpErrorFromResponse } from '@/service/http-error'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { AppACLPermission } from '@/utils/permission'
import { InheritedTracingSummary } from '../inherited-tracing-summary'

const { request } = vi.hoisted(() => ({
  request:
    vi.fn<(url: string, init: RequestInit, options: { request: Request }) => Promise<Response>>(),
}))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request,
}))

const capabilities: TraceProviderCapabilitiesResponse = {
  provider: 'langfuse',
  agent_spans: true,
  session: true,
  native_usage: true,
  native_cost: true,
  trace_url: true,
  span_url: true,
  api_collection_enabled: true,
  export_ack: 'accepted',
}

function setup({
  policy = {
    enabled: true,
    tracing_provider: 'langfuse',
    capture_content: false,
    capture_agent: true,
  },
  permissions = [
    AppACLPermission.ViewLayout,
    AppACLPermission.Monitor,
    AppACLPermission.TracingConfig,
  ],
  providerCapabilities = capabilities,
  failPolicy = false,
}: {
  policy?: AppTraceResponse
  permissions?: string[]
  providerCapabilities?: TraceProviderCapabilitiesResponse
  failPolicy?: boolean
} = {}) {
  const { wrapper, queryClient } = createConsoleQueryWrapper()
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'workflow-1' } } }),
    createAppDetailFixture({ id: 'workflow-1', permission_keys: permissions }),
  )
  const sent: string[] = []
  const state = { failPolicy }
  request.mockImplementation(async (_url, _init, { request: req }) => {
    const url = new URL(req.url)
    sent.push(url.pathname)
    if (url.pathname.endsWith('/apps/workflow-1/trace')) {
      if (state.failPolicy)
        throw await httpErrorFromResponse(
          Response.json({ code: 'unknown', message: 'Unavailable' }, { status: 500 }),
        )
      return Response.json(policy)
    }
    if (url.pathname.endsWith('/apps/workflow-1/trace-capabilities'))
      return Response.json(providerCapabilities)
    throw new Error(`Unexpected request ${req.method} ${url.pathname}`)
  })
  render(<InheritedTracingSummary appId="workflow-1" />, { wrapper })
  return { sent, state, queryClient }
}

const region = () => screen.getByRole('group', { name: 'app.tracing.inherited.title' })

describe('InheritedTracingSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the workflow provider and status in one row, with the explanation on demand', async () => {
    setup()

    const status = await screen.findByText(
      'app.tracing.inherited.providerEnabled:{"provider":"app.tracing.langfuse.title"}',
    )
    expect(region()).toContainElement(status)
    expect(screen.queryByText('app.tracing.inherited.description')).not.toBeInTheDocument()
  })

  it('explains the inheritance and effective capture policy on demand', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByText(
      'app.tracing.inherited.providerEnabled:{"provider":"app.tracing.langfuse.title"}',
    )

    await user.click(screen.getByRole('button', { name: 'app.tracing.inherited.title' }))

    expect(await screen.findByText('app.tracing.inherited.description')).toBeInTheDocument()
    expect(screen.getByText('app.tracing.captureContent').nextElementSibling).toHaveTextContent(
      'app.tracing.inherited.off',
    )
    expect(screen.getByText('app.tracing.captureAgent').nextElementSibling).toHaveTextContent(
      'app.tracing.inherited.on',
    )
  })

  it('distinguishes a disabled provider from a workflow without tracing', async () => {
    const user = userEvent.setup()
    setup({ policy: { enabled: false, tracing_provider: 'langfuse' } })
    expect(
      await screen.findByText(
        'app.tracing.inherited.providerDisabled:{"provider":"app.tracing.langfuse.title"}',
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'app.tracing.inherited.title' }))

    expect(await screen.findByText('app.tracing.inherited.description')).toBeInTheDocument()
    expect(screen.queryByText('app.tracing.captureContent')).not.toBeInTheDocument()
  })

  it('reports an unconfigured workflow without a provider', async () => {
    const { sent } = setup({ policy: { enabled: false, tracing_provider: null } })
    expect(await screen.findByText('app.tracing.inherited.notConfigured')).toBeInTheDocument()
    expect(sent.some((path) => path.endsWith('/trace-capabilities'))).toBe(false)
  })

  it('links to the workflow tracing settings only for users who can monitor and configure', async () => {
    setup()
    const link = await screen.findByRole('link', {
      name: 'app.tracing.inherited.providerEnabled:{"provider":"app.tracing.langfuse.title"}',
    })
    expect(link).toHaveAccessibleDescription(
      'app.tracing.inherited.settings (common.operation.openInNewTab)',
    )
    expect(link).toHaveAttribute('href', '/app/workflow-1/overview?tracing=configure')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('hides the settings link and skips capabilities without monitor permission', async () => {
    const { sent } = setup({ permissions: [AppACLPermission.ViewLayout, AppACLPermission.Edit] })
    expect(
      await screen.findByText(
        'app.tracing.inherited.providerEnabled:{"provider":"app.tracing.langfuse.title"}',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(sent.some((path) => path.endsWith('/trace-capabilities'))).toBe(false)
  })

  it('warns when the provider cannot export full Agent traces', async () => {
    setup({ providerCapabilities: { ...capabilities, agent_spans: false } })
    expect(
      await screen.findByText(
        'app.tracing.inherited.agentSpansUnsupported:{"provider":"app.tracing.langfuse.title"}',
      ),
    ).toBeInTheDocument()
  })

  it('keeps the last known status when a background refresh fails', async () => {
    const { state, queryClient } = setup()
    await screen.findByText(
      'app.tracing.inherited.providerEnabled:{"provider":"app.tracing.langfuse.title"}',
    )

    state.failPolicy = true
    await act(() =>
      queryClient.refetchQueries({
        queryKey: consoleQuery.apps.byAppId.trace.get.queryKey({
          input: { params: { app_id: 'workflow-1' } },
        }),
      }),
    )

    expect(
      screen.getByText(
        'app.tracing.inherited.providerEnabled:{"provider":"app.tracing.langfuse.title"}',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('app.tracing.inherited.loadFailed')).not.toBeInTheDocument()
  })

  it('retries a failed status request in place', async () => {
    const user = userEvent.setup()
    const { state } = setup({ failPolicy: true })
    expect(await screen.findByText('app.tracing.inherited.loadFailed')).toBeInTheDocument()

    state.failPolicy = false
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    expect(
      await screen.findByText(
        'app.tracing.inherited.providerEnabled:{"provider":"app.tracing.langfuse.title"}',
      ),
    ).toBeInTheDocument()
  })
})
