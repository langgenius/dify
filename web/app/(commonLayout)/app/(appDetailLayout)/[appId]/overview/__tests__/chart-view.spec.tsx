import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'

const { request } = vi.hoisted(() => ({ request: vi.fn<(url: string) => Promise<Response>>() }))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request,
}))

const reactEChartsMock = vi.fn()
vi.mock('echarts-for-react/esm/core', () => ({
  default: (props: { option: unknown; opts?: unknown }) => {
    reactEChartsMock(props)
    return <div role="img" aria-label="Chart" />
  },
}))

const respondWith = () => {
  request.mockImplementation(async () => Response.json({ data: [] }))
}

beforeEach(() => {
  request.mockReset()
  reactEChartsMock.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ChartView default period', () => {
  it('starts the default period on the current date after the module stays loaded past midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    respondWith()
    // The module is evaluated on the first visit; the page is mounted the next day.
    vi.setSystemTime(new Date(2026, 11, 1, 9))
    vi.resetModules()
    const ChartView = (await import('../chart-view')).default
    vi.setSystemTime(new Date(2026, 11, 2, 9))

    render(<ChartView appId="app-1" appMode="chat" headerRight={null} />)

    await waitFor(() => {
      const urls = request.mock.calls.map((call) => String(call[0]))
      const messagesUrl = urls.find((url) => url.includes('daily-messages'))
      expect(messagesUrl).toBeTruthy()
      const params = new URL(messagesUrl!).searchParams
      expect(params.get('start')).toBe('2026-11-25 00:00')
      expect(params.get('end')).toBe('2026-12-02 23:59')
    })
  })

  it('starts the cloud default period on the current date after the module stays loaded past midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    respondWith()
    vi.setSystemTime(new Date(2026, 11, 1, 9))
    vi.resetModules()
    const ChartView = (await import('../chart-view')).default
    vi.setSystemTime(new Date(2026, 11, 2, 9))

    render(<ChartView appId="app-1" appMode="chat" headerRight={null} />, {
      systemFeatures: { deployment_edition: 'CLOUD' },
    })

    await waitFor(() => {
      const urls = request.mock.calls.map((call) => String(call[0]))
      const messagesUrl = urls.find((url) => url.includes('daily-messages'))
      expect(messagesUrl).toBeTruthy()
      const params = new URL(messagesUrl!).searchParams
      expect(params.get('start')).toBe('2026-12-02 00:00')
      expect(params.get('end')).toBe('2026-12-02 23:59')
    })
  })
})

describe('RangeSelector', () => {
  it('computes a selected period from the current date after the module stays loaded past midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 11, 1, 9))
    vi.resetModules()
    const RangeSelector = (await import('../time-range-picker/range-selector')).default
    vi.setSystemTime(new Date(2026, 11, 2, 9))
    const onSelect = vi.fn()
    const user = userEvent.setup()

    render(
      <RangeSelector
        isCustomRange={false}
        ranges={[
          { value: 0, name: 'today' },
          { value: 7, name: 'last7days' },
        ]}
        onSelect={onSelect}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'appLog.filter.period.today' }))

    expect(onSelect).toHaveBeenCalledTimes(1)
    const { start, end } = onSelect.mock.calls[0]![0].query
    expect(start.format('YYYY-MM-DD HH:mm')).toBe('2026-12-02 00:00')
    expect(end.format('YYYY-MM-DD HH:mm')).toBe('2026-12-02 23:59')
  })

  it('computes a multi-day period from the current date after the module stays loaded past midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 11, 1, 9))
    vi.resetModules()
    const RangeSelector = (await import('../time-range-picker/range-selector')).default
    vi.setSystemTime(new Date(2026, 11, 2, 9))
    const onSelect = vi.fn()
    const user = userEvent.setup()

    render(
      <RangeSelector
        isCustomRange={false}
        ranges={[
          { value: 0, name: 'today' },
          { value: 7, name: 'last7days' },
        ]}
        onSelect={onSelect}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'appLog.filter.period.last7days' }))

    expect(onSelect).toHaveBeenCalledTimes(1)
    const { start, end } = onSelect.mock.calls[0]![0].query
    expect(start.format('YYYY-MM-DD HH:mm')).toBe('2026-11-25 00:00')
    expect(end.format('YYYY-MM-DD HH:mm')).toBe('2026-12-02 23:59')
  })
})
