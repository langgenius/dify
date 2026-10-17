import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { routeFetchTo } from '@/test/console/fetch'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import Chart, { AppCharts } from '../app-chart'

const reactEChartsMock = vi.fn()
vi.mock('echarts-for-react/esm/core', () => ({
  default: (props: { option: unknown; opts?: unknown }) => {
    reactEChartsMock(props)
    return <div role="img" aria-label="Chart" />
  },
}))

const { request } = vi.hoisted(() => ({ request: vi.fn<() => Promise<Response>>() }))
routeFetchTo(request)

beforeEach(() => {
  request.mockReset()
})

describe('app-chart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reactEChartsMock.mockClear()
  })

  describe('Chart', () => {
    it('should render cost summaries with token pricing details', () => {
      render(
        <Chart
          basicInfo={{
            title: 'Cost title',
            explanation: 'Cost explanation',
            timePeriod: 'Last 7 days',
          }}
          chartType="costs"
          chartData={{
            data: [
              { date: 'Jan 1, 2024', count: 100, total_price: 1.25 },
              { date: 'Jan 2, 2024', count: 200, total_price: 2.5 },
            ],
          }}
        />,
      )

      expect(screen.getByText('Cost title')).toHaveAttribute('title', 'Cost title')
      expect(screen.getByText('300'))!.toBeInTheDocument()
      expect(screen.queryByText('Last 7 days'))!.not.toBeInTheDocument()
      expect(screen.getByText(/\$3\.7500/))!.toBeInTheDocument()
      expect(screen.getByRole('img', { name: 'Chart' }))!.toBeInTheDocument()
    })
  })
})

it('starts workflow statistics together and reveals them only after the last response', async () => {
  const responses: Array<(response: Response) => void> = []
  request.mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        responses.push(resolve)
      }),
  )
  const { rerender } = render(
    <AppCharts id="app-1" appMode="workflow" period={{ name: 'Today' }} />,
  )
  await waitFor(() => expect(responses).toHaveLength(4))
  expect(screen.getAllByRole('region')).toHaveLength(4)
  expect(screen.getAllByRole('status')).toHaveLength(4)
  await act(async () => {
    responses.slice(0, 3).forEach((resolve) => resolve(Response.json({ data: [] })))
  })
  expect(screen.queryByRole('img', { name: 'Chart' })).not.toBeInTheDocument()
  expect(screen.getAllByRole('status')).toHaveLength(4)
  await act(async () => {
    responses[3]!(Response.json({ data: [] }))
  })
  expect(await screen.findAllByRole('img', { name: 'Chart' })).toHaveLength(4)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()

  responses.length = 0
  rerender(
    <AppCharts
      id="app-1"
      appMode="workflow"
      period={{ name: 'Last week', query: { start: '2026-10-08 00:00', end: '2026-10-15 23:59' } }}
    />,
  )
  await waitFor(() => expect(responses).toHaveLength(4))
  await act(async () => {
    responses.slice(0, 3).forEach((resolve) => resolve(Response.json({ data: [] })))
  })
  expect(screen.queryByRole('img', { name: 'Chart' })).not.toBeInTheDocument()
  await act(async () => {
    responses[3]!(Response.json({ data: [] }))
  })
  expect(await screen.findAllByRole('img', { name: 'Chart' })).toHaveLength(4)
})

it('renders zero-valued charts for an empty statistics response', async () => {
  request.mockImplementation(async () => Response.json({ data: [] }))
  render(<AppCharts id="app-1" appMode="workflow" period={{ name: 'Today' }} />)
  expect(await screen.findAllByRole('img', { name: 'Chart' })).toHaveLength(4)
  const messages = screen.getByRole('region', { name: /analysis.totalMessages.title/ })
  expect(within(messages).getByText('0')).toBeInTheDocument()
  expect(within(messages).queryByRole('alert')).not.toBeInTheDocument()
})

it('recovers failed statistics through retry after the batch settles', async () => {
  request.mockImplementation(async () => Response.json({ message: 'Unavailable' }, { status: 503 }))
  render(<AppCharts id="app-1" appMode="workflow" period={{ name: 'Today' }} />)
  const retries = await screen.findAllByRole('button', { name: 'common.errorBoundary.tryAgain' })
  expect(retries).toHaveLength(4)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  request.mockImplementation(async () => Response.json({ data: [] }))
  const user = userEvent.setup()
  await user.click(retries[0]!)
  expect(await screen.findAllByRole('img', { name: 'Chart' })).toHaveLength(4)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('retains loaded charts when a background statistics refresh fails', async () => {
  request.mockImplementation(async () => Response.json({ data: [] }))
  const { queryClient } = render(
    <AppCharts id="app-1" appMode="workflow" period={{ name: 'Today' }} />,
  )
  await screen.findAllByRole('img', { name: 'Chart' })
  request.mockImplementation(async () =>
    Response.json({ message: 'Refresh unavailable' }, { status: 503 }),
  )
  await act(async () => {
    await queryClient.invalidateQueries({
      queryKey: consoleQuery.apps.byAppId.workflow.statistics.key(),
    })
  })
  expect(screen.getAllByRole('img', { name: 'Chart' })).toHaveLength(4)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
