import type { Types } from '@amplitude/analytics-browser'
import * as amplitude from '@amplitude/analytics-browser'
import { getQueryClient } from '@/app/get-query-client'
import { consoleQuery } from '@/service/console'
import { createAgentFixture } from '@/test/fixtures/agent'
import { initializeAmplitudeSDK } from '../runtime'

vi.mock('@amplitude/analytics-browser', () => ({
  init: vi.fn(),
  add: vi.fn(),
  setOptOut: vi.fn(),
  track: vi.fn(),
  flush: vi.fn(),
  setUserId: vi.fn(),
  Identify: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
}))
vi.mock('@amplitude/plugin-session-replay-browser', () => ({
  sessionReplayPlugin: vi.fn(() => ({ name: 'replay' })),
}))

const pageView = (url: string): Types.Event => ({
  event_type: '[Amplitude] Page Viewed',
  event_properties: { '[Amplitude] Page URL': url },
})
const getPlugin = () => {
  initializeAmplitudeSDK('test-key', 0)
  return vi.mocked(amplitude.add).mock.calls[0]![0] as Types.EnrichmentPlugin
}

beforeEach(() => {
  vi.clearAllMocks()
  getQueryClient().clear()
})

it('registers enrichment before initialization can capture the first page view', () => {
  getPlugin()
  expect(vi.mocked(amplitude.add).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(amplitude.init).mock.invocationCallOrder[0]!,
  )
})

it.each([
  ['https://cloud.dify.ai/app/app-a/access-point', 'app-a'],
  ['https://cloud.dify.ai/console/app/app-b/access-point?settings=ip-policies', 'app-b'],
])('enriches %s from the event URL even after navigation', async (url, appId) => {
  const event = pageView(url)
  const result = await getPlugin().execute!(event)
  expect(result?.event_properties).toMatchObject({ app_id: appId })
  expect(amplitude.track).not.toHaveBeenCalled()
})

it('uses the associated App ID from the cached Agent query', async () => {
  const options = consoleQuery.agent.byAgentId.get.queryOptions({
    input: { params: { agent_id: 'agent-a' } },
  })
  getQueryClient().setQueryData(
    options.queryKey,
    createAgentFixture({ id: 'agent-a', app_id: 'backing-app', hidden_app_backed: false }),
  )
  const result = await getPlugin().execute!(pageView('https://cloud.dify.ai/agents/agent-a/access'))
  expect(result?.event_properties).toMatchObject({ app_id: 'backing-app' })
  expect(globalThis.fetch).not.toHaveBeenCalled()
})

it('keeps a failed Agent lookup page view without inventing an App ID', async () => {
  vi.mocked(globalThis.fetch).mockResolvedValue(
    Response.json({ message: 'Unavailable' }, { status: 503 }),
  )
  const event = pageView('https://cloud.dify.ai/agents/agent-a/access')
  expect(await getPlugin().execute!(event)).toBe(event)
  expect(event.event_properties).not.toHaveProperty('app_id')
})

it('keeps a pending Agent lookup attached to its original page view during navigation', async () => {
  let resolveAgent!: (response: Response) => void
  vi.mocked(globalThis.fetch).mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        resolveAgent = resolve
      }),
  )
  const plugin = getPlugin()
  const event = pageView('https://cloud.dify.ai/agents/agent-a/access')
  const pending = plugin.execute!(event)
  await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledOnce())
  window.history.replaceState({}, '', '/app/app-b/access-point')
  const next = await plugin.execute!(pageView(window.location.href))
  resolveAgent(
    Response.json(
      createAgentFixture({ id: 'agent-a', app_id: 'backing-app-a', hidden_app_backed: false }),
    ),
  )
  expect((await pending)?.event_properties).toMatchObject({ app_id: 'backing-app-a' })
  expect(next?.event_properties).toMatchObject({ app_id: 'app-b' })
  expect(amplitude.track).not.toHaveBeenCalled()
  window.history.replaceState({}, '', '/')
})

it('leaves other pages and custom events without Access Point properties', async () => {
  const plugin = getPlugin()
  const event = pageView('https://cloud.dify.ai/apps')
  await plugin.execute!(event)
  expect(event.event_properties).not.toHaveProperty('app_id')
  const custom = {
    ...pageView('https://cloud.dify.ai/app/app-a/access-point'),
    event_type: 'custom',
  }
  await plugin.execute!(custom)
  expect(custom.event_properties).not.toHaveProperty('app_id')
  expect(globalThis.fetch).not.toHaveBeenCalled()
})
