import type { AppTraceResponse } from '@dify/contracts/api/console/apps/types.gen'
import { render } from 'vitest-browser-react'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { createTestQueryClient } from '@/test/query-client'
import { TracingConfiguration } from '../configuration'

const { request } = vi.hoisted(() => ({
  request:
    vi.fn<(url: string, init: RequestInit, options: { request: Request }) => Promise<Response>>(),
}))
// boundary: generated API transport; authorization controls and persistence observers remain real.
vi.mock('@/service/base', () => ({ request }))

function server(nativeTracingEnabled: boolean) {
  let policy: AppTraceResponse = {
    enabled: false,
    tracing_provider: null,
    capture_content: false,
    capture_agent: true,
  }
  const writes: AppTraceResponse[] = []
  request.mockImplementation(async (_url, _init, { request: sent }) => {
    const path = new URL(sent.url).pathname
    if (path.endsWith('/system-features'))
      return Response.json(
        createSystemFeaturesFixture({ agent_tracing_api_collection_enabled: nativeTracingEnabled }),
      )
    if (path.endsWith('/trace')) {
      if (sent.method === 'POST') {
        policy = await sent.json()
        writes.push(policy)
        return Response.json({ result: 'success' })
      }
      return Response.json(policy)
    }
    if (path.endsWith('/trace-config')) return Response.json({ has_not_configured: true })
    throw new Error(`Unexpected request: ${path}`)
  })
  return { writes }
}

async function setup(readOnly = false) {
  const QueryProvider = createQueryClientWrapper(createTestQueryClient())
  const { wrapper: NuqsProvider } = createNuqsTestWrapper({ hasMemory: true })
  return render(
    <QueryProvider>
      <NuqsProvider>
        <TracingConfiguration
          resource={{ kind: 'app', appId: 'app-1', mode: 'workflow' }}
          readOnly={readOnly}
        />
      </NuqsProvider>
    </QueryProvider>,
  )
}

it.each([true, false])(
  'saves App consent without selecting or enabling an App exporter (Native tracing: %s)',
  async (nativeTracingEnabled) => {
    const { writes } = server(nativeTracingEnabled)
    const screen = await setup()
    await screen.getByRole('button', { name: 'app.tracing.title' }).click()
    const authorization = screen.getByRole('switch', {
      name: 'app.tracing.appContentAuthorization',
    })
    await expect.element(authorization).toBeVisible()
    await expect
      .element(authorization)
      .toHaveAccessibleDescription('app.tracing.appContentAuthorizationDescription')
    await expect.element(authorization).not.toBeChecked()
    if (!nativeTracingEnabled)
      await expect
        .element(screen.getByRole('note'))
        .toHaveTextContent('app.tracing.appAgentTracingUnavailable')
    await authorization.click()
    await expect
      .poll(() => writes)
      .toEqual([
        {
          enabled: false,
          tracing_provider: null,
          capture_content: true,
          capture_agent: true,
        },
      ])
    await expect.element(authorization).toBeChecked()
    await screen.getByRole('button', { name: 'app.tracing.title' }).click()
    await expect.element(authorization).not.toBeInTheDocument()
    await screen.getByRole('button', { name: 'app.tracing.title' }).click()
    await expect
      .element(screen.getByRole('switch', { name: 'app.tracing.appContentAuthorization' }))
      .toBeChecked()
    await expect
      .element(screen.getByRole('switch', { name: 'app.tracing.tracing' }))
      .not.toBeChecked()
    await expect.element(screen.getByRole('switch', { name: 'app.tracing.tracing' })).toBeDisabled()
  },
)

it('shows independent consent read-only without an App destination or Native tracing', async () => {
  const { writes } = server(false)
  const screen = await setup(true)
  await screen.getByRole('button', { name: 'app.tracing.title' }).click()
  const authorization = screen.getByRole('switch', { name: 'app.tracing.appContentAuthorization' })
  await expect.element(authorization).toBeVisible()
  await authorization.click()
  await expect.element(authorization).not.toBeChecked()
  expect(writes).toEqual([])
  expect(
    request.mock.calls.filter(([, , { request: sent }]) =>
      new URL(sent.url).pathname.endsWith('/trace-config'),
    ),
  ).toEqual([])
})
