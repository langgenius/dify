import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { createDeferred } from '@/test/deferred'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { createTestQueryClient } from '@/test/query-client'
import { TracingConfiguration } from '../configuration'

const { request } = vi.hoisted(() => ({
  request:
    vi.fn<(url: string, init: RequestInit, options: { request: Request }) => Promise<Response>>(),
}))
vi.mock('@/service/base', () => ({ request }))

// Chromium drops native-button focus when pending saves disable the selected radio;
// the unit DOM environment does not reproduce that loss.
it('preserves provider focus during an async save and allows keyboard selection after saving', async () => {
  const save = createDeferred<void>()
  let status = { enabled: true, tracing_provider: 'langfuse' }
  const writes: unknown[] = []
  request.mockImplementation(async (_url, _init, { request: sent }) => {
    const url = new URL(sent.url)
    if (url.pathname.endsWith('/system-features'))
      return Response.json(createSystemFeaturesFixture())
    if (url.pathname.endsWith('/trace')) {
      if (sent.method === 'POST') {
        const body = await sent.json()
        writes.push(body)
        if (writes.length === 1) await save.promise
        status = body
        return Response.json({ result: 'success' })
      }
      return Response.json(status)
    }
    const provider = url.searchParams.get('tracing_provider')
    const config =
      provider === 'langfuse'
        ? { public_key: 'public', secret_key: 'secret', host: 'https://cloud.langfuse.com' }
        : provider === 'langsmith'
          ? { api_key: 'key', project: 'project', endpoint: 'https://api.smith.langchain.com' }
          : null
    return Response.json({ has_not_configured: !config, tracing_config: config })
  })
  const QueryProvider = createQueryClientWrapper(createTestQueryClient())
  const { wrapper: NuqsProvider } = createNuqsTestWrapper({ hasMemory: true })
  const screen = await render(
    <QueryProvider>
      <NuqsProvider>
        <TracingConfiguration
          resource={{ kind: 'app', appId: 'app-1', mode: 'chat' }}
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
  await expect.poll(() => writes.length).toBe(1)
  await expect.element(langsmith).toBeChecked()
  await expect.element(langsmith).toHaveFocus()
  await userEvent.keyboard('{ArrowLeft}')
  await expect.element(langfuse).toHaveFocus()
  await expect.element(langsmith).toBeChecked()
  await userEvent.keyboard(' ')
  expect(writes).toHaveLength(1)
  await userEvent.keyboard('{ArrowRight}')
  await expect.element(langsmith).toHaveFocus()
  save.resolve()
  await expect.element(group).not.toHaveAttribute('aria-readonly', 'true')
  await expect.element(langsmith).toHaveFocus()
  await userEvent.keyboard('{ArrowLeft}')
  await expect.poll(() => writes.length).toBe(2)
  await expect.element(langfuse).toBeChecked()
  await expect.element(langfuse).toHaveFocus()
  expect(writes).toEqual([
    expect.objectContaining({ tracing_provider: 'langsmith' }),
    expect.objectContaining({ tracing_provider: 'langfuse' }),
  ])
})
