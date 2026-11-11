import { echarts } from '@/app/components/base/line-chart/echarts'
import { buildChartOptions } from '../app-chart-utils'

const statistics = Array.from({ length: 8 }, (_v, index) => ({
  date: `2026-01-0${index + 1}`,
  count: index + 1,
}))

it('keeps the first x-axis label inside the chart on narrow overview cards', () => {
  const container = document.createElement('div')
  container.style.cssText = 'position:absolute;left:0;top:0;width:342px;height:200px;'
  document.body.appendChild(container)

  const chart = echarts.init(container, undefined, { renderer: 'svg' })
  try {
    chart.setOption({
      ...buildChartOptions({ statistics, chartType: 'conversations', yField: 'count' }),
      animation: false,
    })

    const containerRect = container.getBoundingClientRect()
    const firstLabel = [...container.querySelectorAll('text')].find(
      (text) => text.textContent === 'Jan 1, 2026',
    )

    expect(firstLabel).toBeTruthy()
    const labelRect = firstLabel!.getBoundingClientRect()

    expect(labelRect.left - containerRect.left).toBeGreaterThanOrEqual(0)
  } finally {
    chart.dispose()
    container.remove()
  }
})
