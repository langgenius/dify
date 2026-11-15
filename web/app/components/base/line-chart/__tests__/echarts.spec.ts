import { buildChartOptions as buildOverviewOptions } from '@/app/components/app/overview/app-chart-utils'
import { buildChartOptions as buildMonitoringOptions } from '@/features/agent-v2/agent-detail/monitoring/chart-utils'
import { echarts } from '../echarts'

it.each([
  [
    'overview',
    buildOverviewOptions({
      statistics: [
        { date: '2026-01-01', count: 3 },
        { date: '2026-01-02', count: 7 },
      ],
      chartType: 'conversations',
      yField: 'count',
    }),
  ],
  [
    'monitoring',
    buildMonitoringOptions({
      rows: [
        { date: '2026-01-01', count: 3 },
        { date: '2026-01-02', count: 7 },
      ],
      chartType: 'conversations',
      valueKey: 'count',
    }),
  ],
] as const)('renders the %s dataset with the registered line-chart runtime', (_name, option) => {
  const chart = echarts.init(null, undefined, {
    renderer: 'svg',
    ssr: true,
    width: 400,
    height: 240,
  })
  try {
    chart.setOption({ ...option, animation: false })
    const svg = chart.renderToSVGString()
    expect(svg).toContain('stroke="rgb(6,148,162)"')
    expect(svg).toContain('Jan')
  } finally {
    chart.dispose()
  }
})
