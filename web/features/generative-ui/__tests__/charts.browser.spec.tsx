import { expect, it } from 'vite-plus/test'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { GeneratedBarChart, GeneratedLineChart } from '../components/charts'

function ChartResponse({ points }: { points: { label: string; value: number }[] }) {
  return (
    <div className="w-full max-w-2xl space-y-4">
      <GeneratedLineChart
        title="Monthly revenue trend"
        unit="CNY 10k"
        points={[
          { label: 'First-quarter 2026 sales revenue', value: 120 },
          { label: 'Second-quarter 2026 sales revenue', value: 180 },
          { label: 'Third-quarter 2026 sales revenue', value: 160 },
        ]}
      />
      <GeneratedBarChart title="Regional profit" unit="CNY 10k" points={points} />
    </div>
  )
}

it('resizes real ECharts surfaces with the chat response and replaces their plotted categories', async () => {
  // Unit tests replace the ECharts SDK. This proves its SVG renderer receives size
  // changes and new data without clipping the chat response or retaining old labels.
  await page.viewport(800, 1200)
  const screen = await render(
    <ChartResponse
      points={[
        { label: 'Northern region including enterprise accounts', value: -40 },
        { label: 'Southern region', value: 0 },
        { label: 'Eastern region', value: 80 },
      ]}
    />,
  )

  const trend = screen.getByRole('figure', { name: 'Monthly revenue trend' })
  await expect.element(trend).toBeVisible()
  await expect
    .poll(() => trend.element().querySelector('svg')?.getBoundingClientRect().width ?? 0)
    .toBeGreaterThan(320)
  const wideWidth = trend.element().querySelector('svg')!.getBoundingClientRect().width

  await page.viewport(360, 1200)
  await expect
    .poll(() => trend.element().querySelector('svg')?.getBoundingClientRect().width ?? wideWidth)
    .toBeLessThan(wideWidth)

  for (const title of ['Monthly revenue trend', 'Regional profit']) {
    const chart = screen.getByRole('figure', { name: title })
    await expect.element(chart).toBeVisible()
    await expect
      .poll(() => chart.element().querySelector('svg')?.getBoundingClientRect().width ?? 0)
      .toBeGreaterThan(0)
    const element = chart.element()
    expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth)
    const surface = element.querySelector('svg')!.getBoundingClientRect()
    expect(surface.height).toBeGreaterThan(0)
    expect(surface.left).toBeGreaterThanOrEqual(element.getBoundingClientRect().left)
    expect(surface.right).toBeLessThanOrEqual(element.getBoundingClientRect().right)
  }
  await screen.getByText('appDebug.generativeUI.chartData').click()
  await expect.element(screen.getByText('180 CNY 10k')).toBeVisible()
  await expect
    .element(screen.getByText('Northern region including enterprise accounts'))
    .toBeVisible()
  await expect.element(screen.getByText('-40 CNY 10k')).toBeVisible()

  await screen.rerender(
    <ChartResponse
      points={[
        { label: 'Updated region', value: -24 },
        { label: 'Zero region', value: 0 },
      ]}
    />,
  )
  const comparison = screen.getByRole('figure', { name: 'Regional profit' })
  await expect
    .poll(() => comparison.element().querySelector('svg')?.textContent)
    .toContain('Updated region')
  const plottedLabels = comparison.element().querySelector('svg')!.textContent
  expect(plottedLabels).not.toContain('Southern region')
  expect(plottedLabels).not.toContain('Eastern region')
  await expect.element(screen.getByText('-24 CNY 10k')).toBeVisible()
  await expect.element(screen.getByText('0 CNY 10k')).toBeVisible()
})
