import type { AppTraceResponse } from '@dify/contracts/api/console/apps/types.gen'
import { render } from 'vitest-browser-react'
import { TEST_APP_ID } from '@/test/console/ids'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { installFakeApi } from '@/test/fake-api'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { createTestQueryClient } from '@/test/query-client'
import { TracingConfiguration } from '../configuration'

function server(nativeTracingEnabled: boolean) {
  let policy: AppTraceResponse = {
    enabled: false,
    tracing_provider: null,
    capture_content: false,
    capture_agent: true,
  }
  const writes: AppTraceResponse[] = []
  const fake = installFakeApi({
    console: {
      systemFeatures: {
        get: () =>
          createSystemFeaturesFixture({
            agent_tracing_api_collection_enabled: nativeTracingEnabled,
          }),
      },
      apps: {
        byAppId: {
          trace: {
            get: () => policy,
            post: ({ body }) => {
              policy = body
              writes.push(policy)
              return { result: 'success' }
            },
          },
          traceConfig: { get: () => ({ has_not_configured: true }) },
        },
      },
    },
  })
  onTestFinished(fake)
  return { writes, fake }
}

async function setup(readOnly = false) {
  const QueryProvider = createQueryClientWrapper(createTestQueryClient())
  const { wrapper: NuqsProvider } = createNuqsTestWrapper({ hasMemory: true })
  return render(
    <QueryProvider>
      <NuqsProvider>
        <TracingConfiguration
          resource={{ kind: 'app', appId: TEST_APP_ID, mode: 'workflow' }}
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
  const { writes, fake } = server(false)
  const screen = await setup(true)
  await screen.getByRole('button', { name: 'app.tracing.title' }).click()
  const authorization = screen.getByRole('switch', { name: 'app.tracing.appContentAuthorization' })
  await expect.element(authorization).toBeVisible()
  await authorization.click()
  await expect.element(authorization).not.toBeChecked()
  expect(writes).toEqual([])
  expect(fake.console.apps.byAppId.traceConfig.get).not.toHaveBeenCalled()
})
