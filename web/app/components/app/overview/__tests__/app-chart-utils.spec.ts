import { buildChartOptions, getDefaultChartData, getSummaryValue, getTokenSummary } from '../app-chart-utils'

describe('app-chart-utils', () => {
  describe('getDefaultChartData', () => {
    it('should build fallback rows for the requested date window', () => {
      const rows = getDefaultChartData({
        start: 'Jan 1, 2024',
        end: 'Jan 4, 2024',
        key: 'interactions',
      })

      expect(rows).toHaveLength(3)
      expect(rows[0]).toEqual({ date: 'Jan 1, 2024', interactions: 0 })
      expect(rows[2]).toEqual({ date: 'Jan 3, 2024', interactions: 0 })
    })
  })

  describe('getSummaryValue', () => {
    it('should average values when the chart is configured as an average', () => {
      const summaryValue = getSummaryValue({
        chartType: 'conversations',
        statistics: [
          { date: 'Jan 1, 2024', latency: 10 },
          { date: 'Jan 2, 2024', latency: 20 },
        ],
        yField: 'latency',
        isAvg: true,
        unit: 'ms',
      })

      expect(summaryValue).toBe('15 ms')
    })

    it('should compress large cost totals with a k suffix', () => {
      const summaryValue = getSummaryValue({
        chartType: 'costs',
        statistics: [
          { date: 'Jan 1, 2024', count: 700 },
          { date: 'Jan 2, 2024', count: 800 },
        ],
        yField: 'count',
      })

      expect(summaryValue).toBe('2k')
    })
  })

  describe('getTokenSummary', () => {
    it('should sum token costs using currency formatting', () => {
      const tokenSummary = getTokenSummary([
        { date: 'Jan 1, 2024', count: 1, total_price: '1.25' },
        { date: 'Jan 2, 2024', count: 2, total_price: '2.5' },
      ])

      expect(tokenSummary).toBe('$3.7500')
    })
  })

  describe('buildChartOptions', () => {
    it('should build line chart options with dataset and y-axis max', () => {
      const options = buildChartOptions({
        statistics: [
          { date: 'Jan 1, 2024', count: 5 },
          { date: 'Jan 2, 2024', count: 10 },
        ],
        chartType: 'messages',
        yField: 'count',
        yMax: 100,
      })

      const dataset = options.dataset as { dimensions: string[], source: Array<Record<string, unknown>> }
      const yAxis = options.yAxis as { max: number }
      const series = options.series as Array<{ lineStyle: { color: string } }>

      expect(dataset.dimensions).toEqual(['date', 'count'])
      expect(dataset.source).toHaveLength(2)
      expect(yAxis.max).toBe(100)
      expect(series[0].lineStyle.color).toBe('rgba(6, 148, 162, 1)')
    })
  })
})
