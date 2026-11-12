import type { WorkflowRunNodeExecutionResponse } from '@dify/contracts/api/console/apps/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { useLastRun } from '../use-workflow'

const api = vi.hoisted(() => ({ read: vi.fn() }))
// boundary: only generated remote LastRun GET responses are replaced; real query keys and observers own polling.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflows.draft.nodes.byNodeId.lastRun.get': api.read,
    }),
  }
})
const execution = (status: string, id = 'current'): WorkflowRunNodeExecutionResponse => ({
  id,
  status,
  process_data: { external_invocation_id: 'invocation-1' },
})

it('ignores a previous execution and reads the accepted node-debug execution through paused/running to terminal', async ({
  onTestFinished,
}) => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  onTestFinished(() => client.clear())
  api.read
    .mockReset()
    .mockResolvedValueOnce(execution('succeeded', 'previous'))
    .mockResolvedValueOnce(execution('paused'))
    .mockRejectedValueOnce(new Error('Temporary network failure'))
    .mockResolvedValueOnce(execution('running'))
    .mockResolvedValue(execution('succeeded'))
  const { result } = renderHook(
    () =>
      useLastRun(
        { kind: 'app', appId: 'app-1', mode: 'workflow', collaborationEnabled: false },
        'node-1',
        true,
        'current',
      ),
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(result.current.data).toBeUndefined()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500)
  })
  expect(result.current.data?.status).toBe('paused')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500)
  })
  expect(result.current.data?.status).toBe('paused')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500)
  })
  expect(result.current.data?.status).toBe('running')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500)
  })
  expect(result.current.data?.status).toBe('succeeded')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000)
  })
  expect(api.read).toHaveBeenCalledTimes(5)
})
