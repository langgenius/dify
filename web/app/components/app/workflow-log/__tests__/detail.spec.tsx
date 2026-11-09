import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNodeTracing } from '@/app/components/workflow/__tests__/fixtures'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import DetailPanel from '../detail'
import { createLogRun } from './run-fixture'

const mockRouterPush = vi.fn()
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: mockRouterPush }) }))
const { fetchRunDetail, fetchTracingList } = vi.hoisted(() => ({
  fetchRunDetail: vi.fn(),
  fetchTracingList: vi.fn(),
}))
vi.mock('@/service/log', () => ({ fetchRunDetail, fetchTracingList }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.traceRuns.bySourceKind.bySourceId.get': () => ({ status: 'not_collected' }),
    }),
  }
})
beforeEach(() => {
  fetchRunDetail.mockImplementation(async (url: string) => createLogRun(url.split('/').at(-1)!))
  fetchTracingList.mockImplementation(async ({ url }: { url: string }) => ({
    data: [createNodeTracing({ title: `Execution for ${url.split('/').at(-2)}` })],
  }))
})

it('loads and displays the selected run and its execution trace', async () => {
  const user = userEvent.setup()
  render(<DetailPanel appId="app-456" runID="run-789" onClose={vi.fn()} />)
  expect(fetchRunDetail).toHaveBeenCalledWith('/apps/app-456/workflow-runs/run-789', {
    silent: true,
  })
  expect(
    screen.queryByRole('button', { name: 'appLog.runDetail.testWithParams' }),
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: 'runLog.tracing' }))
  expect(await screen.findByText('Execution for run-789')).toBeInTheDocument()
  expect(fetchTracingList).toHaveBeenCalledWith(
    { url: '/apps/app-456/workflow-runs/run-789/node-executions' },
    { silent: true },
  )
})

it('requests no run data without a selected run', () => {
  render(<DetailPanel appId="app-456" runID="" onClose={vi.fn()} />)
  expect(
    screen.getByRole('heading', { name: 'appLog.runDetail.workflowTitle' }),
  ).toBeInTheDocument()
  expect(fetchRunDetail).not.toHaveBeenCalled()
  expect(fetchTracingList).not.toHaveBeenCalled()
})

it('requests dismissal from the close action', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  render(<DetailPanel appId="test-app-id" runID="run-123" onClose={onClose} />)
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  expect(onClose).toHaveBeenCalledOnce()
})

it('navigates to replay the selected run', async () => {
  const user = userEvent.setup()
  render(<DetailPanel appId="app-replay-test" runID="run-to-replay" onClose={vi.fn()} canReplay />)
  await user.click(screen.getByRole('button', { name: 'appLog.runDetail.testWithParams' }))
  expect(mockRouterPush).toHaveBeenCalledWith(
    '/app/app-replay-test/workflow?replayRunId=run-to-replay',
  )
})
