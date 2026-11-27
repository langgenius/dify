import type {
  AppTraceResponse,
  TraceAppConfigResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { createDeferred } from '@/test/deferred'
import { installFakeApi } from '@/test/fake-api'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { createTestQueryClient } from '@/test/query-client'
import { TracingConfiguration } from '../configuration'

// Chromium drops native-button focus when pending saves disable the selected radio;
// the unit DOM environment does not reproduce that loss.
it('preserves provider focus during an async save and allows keyboard selection after saving', async () => {
  const save = createDeferred<void>()
  let status: AppTraceResponse = { enabled: true, tracing_provider: 'langfuse' }
  const fake = installFakeApi({
    console: {
      systemFeatures: { get: () => createSystemFeaturesFixture() },
      apps: {
        byAppId: {
          trace: {
            get: () => status,
            post: async ({ body }) => {
              await save.promise
              status = body
              return { result: 'success' }
            },
          },
          traceConfig: {
            get: ({ query }): TraceAppConfigResponse =>
              query.tracing_provider === 'langfuse'
                ? {
                    tracing_config: { host: 'https://cloud.langfuse.com' },
                    configured_secrets: ['public_key', 'secret_key'],
                  }
                : query.tracing_provider === 'langsmith'
                  ? {
                      tracing_config: {
                        project: 'project',
                        endpoint: 'https://api.smith.langchain.com',
                      },
                      configured_secrets: ['api_key'],
                    }
                  : { has_not_configured: true },
          },
        },
      },
    },
  })
  onTestFinished(fake)
  const QueryProvider = createQueryClientWrapper(createTestQueryClient())
  const { wrapper: NuqsProvider } = createNuqsTestWrapper({ hasMemory: true })
  const screen = await render(
    <QueryProvider>
      <NuqsProvider>
        <TracingConfiguration
          resource={{ kind: 'app', appId: '6f1d0c5e-3a0b-4c4e-9f5a-1b2c3d4e5f60', mode: 'chat' }}
          readOnly={false}
        />
      </NuqsProvider>
    </QueryProvider>,
  )
  await screen.getByRole('button', { name: /app.tracing.enabled/ }).click()
  const group = screen.getByRole('radiogroup')
  const langfuse = group.getByRole('radio', { name: 'app.tracing.langfuse.title' })
  const langsmith = group.getByRole('radio', { name: 'app.tracing.langsmith.title' })
  await langfuse.click()
  await expect.element(langfuse).toHaveFocus()
  await userEvent.keyboard('{ArrowRight}')
  await expect.poll(() => fake.console.apps.byAppId.trace.post).toHaveBeenCalledOnce()
  await expect.element(langsmith).toBeChecked()
  await expect.element(langsmith).toHaveFocus()
  await userEvent.keyboard('{ArrowLeft}')
  await expect.element(langfuse).toHaveFocus()
  await expect.element(langsmith).toBeChecked()
  await userEvent.keyboard(' ')
  expect(fake.console.apps.byAppId.trace.post).toHaveBeenCalledOnce()
  await userEvent.keyboard('{ArrowRight}')
  await expect.element(langsmith).toHaveFocus()
  save.resolve()
  await expect.element(group).not.toHaveAttribute('aria-readonly', 'true')
  await expect.element(langsmith).toHaveFocus()
  await userEvent.keyboard('{ArrowLeft}')
  await expect.poll(() => fake.console.apps.byAppId.trace.post).toHaveBeenCalledTimes(2)
  await expect.element(langfuse).toBeChecked()
  await expect.element(langfuse).toHaveFocus()
  expect(fake.console.apps.byAppId.trace.post.mock.calls).toEqual([
    [expect.objectContaining({ body: expect.objectContaining({ tracing_provider: 'langsmith' }) })],
    [expect.objectContaining({ body: expect.objectContaining({ tracing_provider: 'langfuse' }) })],
  ])
})
