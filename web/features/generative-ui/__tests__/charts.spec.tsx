import type { EChartsOption } from 'echarts'
import type { EChartsReactProps } from 'echarts-for-react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import { GeneratedBarChart, GeneratedLineChart } from '../components/charts'

type ChartAdapterProps = Pick<EChartsReactProps, 'notMerge' | 'opts'> & { option: EChartsOption }

const { renderChart } = vi.hoisted(() => ({
  renderChart: vi.fn<(props: ChartAdapterProps) => void>(),
}))

vi.mock('echarts-for-react/esm/core', () => ({
  default: (props: ChartAdapterProps) => {
    renderChart(props)
    return null
  },
}))

describe('Generated charts', () => {
  it('makes every trend point available as exact labeled data in supplied order', async () => {
    const user = userEvent.setup()
    render(
      <GeneratedLineChart
        title="Monthly revenue"
        unit="USD"
        points={[
          { label: 'January', value: 1200.5 },
          { label: 'February', value: -200.25 },
          { label: 'March', value: 0 },
        ]}
      />,
    )

    const chart = screen.getByRole('figure', { name: 'Monthly revenue' })
    await user.click(within(chart).getByText('appDebug.generativeUI.chartData'))
    expect(
      within(chart)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(['January', 'February', 'March'])
    expect(
      within(chart)
        .getAllByRole('definition')
        .map((value) => value.textContent),
    ).toEqual(['1,200.5 USD', '-200.25 USD', '0 USD'])
    expect(renderChart).toHaveBeenLastCalledWith(
      expect.objectContaining({
        option: expect.objectContaining({
          xAxis: expect.objectContaining({ data: ['January', 'February', 'March'] }),
          series: [expect.objectContaining({ type: 'line', data: [1200.5, -200.25, 0] })],
        }),
      }),
    )
  })

  it('preserves signed category values and input order in comparisons', async () => {
    render(
      <GeneratedBarChart
        title="Regional profit"
        unit="CNY 10k"
        points={[
          { label: 'East', value: -40 },
          { label: 'South', value: 0 },
          { label: 'North', value: 80 },
        ]}
      />,
    )

    const chart = screen.getByRole('figure', { name: 'Regional profit' })
    expect(
      within(chart)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(['East', 'South', 'North'])
    expect(
      within(chart)
        .getAllByRole('definition')
        .map((value) => value.textContent),
    ).toEqual(['-40 CNY 10k', '0 CNY 10k', '80 CNY 10k'])
    await waitFor(() =>
      expect(renderChart).toHaveBeenLastCalledWith(
        expect.objectContaining({
          option: expect.objectContaining({
            yAxis: expect.objectContaining({ data: ['East', 'South', 'North'] }),
            series: [expect.objectContaining({ type: 'bar', data: [-40, 0, 80] })],
          }),
        }),
      ),
    )
  })

  it('replaces old categories and values when a new comparison arrives', async () => {
    const { rerender } = render(
      <GeneratedBarChart
        title="Regional profit"
        points={[
          { label: 'East', value: 40 },
          { label: 'South', value: 80 },
        ]}
      />,
    )
    rerender(<GeneratedBarChart title="Regional profit" points={[{ label: 'West', value: 0 }]} />)

    const chart = within(screen.getByRole('figure', { name: 'Regional profit' }))
    expect(chart.getAllByRole('term').map((term) => term.textContent)).toEqual(['West'])
    expect(chart.getByRole('definition')).toHaveTextContent('0')
    expect(chart.queryByText('East')).not.toBeInTheDocument()
    expect(chart.queryByText('South')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(renderChart).toHaveBeenLastCalledWith(
        expect.objectContaining({
          notMerge: true,
          option: expect.objectContaining({
            yAxis: expect.objectContaining({ data: ['West'] }),
            series: [expect.objectContaining({ type: 'bar', data: [0] })],
          }),
        }),
      ),
    )
  })

  it('shows an empty chart without inventing a zero-valued point', () => {
    render(<GeneratedLineChart title="Pending trend" points={[]} />)
    const chart = screen.getByRole('figure', { name: 'Pending trend' })
    expect(within(chart).getByText('appDebug.generativeUI.chartEmpty')).toBeVisible()
    expect(within(chart).queryByRole('definition')).not.toBeInTheDocument()
    expect(renderChart).not.toHaveBeenCalled()
  })
})
