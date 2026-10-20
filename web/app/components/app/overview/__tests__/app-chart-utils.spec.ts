import type { LineSeriesOption } from 'echarts'
import {
  buildChartOptions,
  getChartValueField,
  getDefaultChartData,
  getSummaryValue,
  getTokenSummary,
  hasNonZeroChartData,
} from '../app-chart-utils'

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

  describe('hasNonZeroChartData', () => {
    it('should detect whether rows contain a non-zero chart value', () => {
      expect(
        hasNonZeroChartData(
          [
            { date: 'Jan 1, 2024', count: 0 },
            { date: 'Jan 2, 2024', count: '0' },
          ],
          'count',
        ),
      ).toBe(false)

      expect(
        hasNonZeroChartData(
          [
            { date: 'Jan 1, 2024', count: 0 },
            { date: 'Jan 2, 2024', count: 1 },
          ],
          'count',
        ),
      ).toBe(true)
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

    it('should keep small cost totals in their raw form', () => {
      const summaryValue = getSummaryValue({
        chartType: 'costs',
        statistics: [
          { date: 'Jan 1, 2024', count: 250 },
          { date: 'Jan 2, 2024', count: 300 },
        ],
        yField: 'count',
      })

      expect(summaryValue).toBe('550')
    })
  })

  describe('getChartValueField', () => {
    it('should prefer the explicit value key and otherwise fall back to the count-like field', () => {
      expect(getChartValueField([{ date: 'Jan 1, 2024', request_count: 2 }], 'total')).toBe('total')
      expect(getChartValueField([{ date: 'Jan 1, 2024', request_count: 2 }])).toBe('request_count')
      expect(getChartValueField([{ date: 'Jan 1, 2024', latency: 2 }])).toBe('count')
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

      const dataset = options.dataset as {
        dimensions: string[]
        source: Array<Record<string, unknown>>
      }
      const yAxis = options.yAxis as { max: number }

      expect(dataset.dimensions).toEqual(['date', 'count'])
      expect(dataset.source).toHaveLength(2)
      expect(yAxis.max).toBe(100)
    })

    it('should build token-aware tooltip content for cost charts', () => {
      const options = buildChartOptions({
        statistics: [
          { date: 'Jan 1, 2024', total_cost: 5, total_price: '1.25' },
          { date: 'Jan 2, 2024', total_cost: 10, total_price: '2.50' },
          { date: 'Jan 3, 2024', total_cost: 15, total_price: '3.75' },
        ],
        chartType: 'costs',
        yField: 'total_cost',
      })

      const series = options.series as LineSeriesOption[]
      const tooltipFormatter = series[0]!.tooltip!.formatter
      if (typeof tooltipFormatter !== 'function') throw new Error('Expected a tooltip formatter')

      expect(
        tooltipFormatter(
          {
            componentType: 'series',
            componentSubType: 'line',
            componentIndex: 0,
            value: 10,
            seriesType: 'line',
            seriesIndex: 0,
            seriesName: 'costs',
            dataIndex: 1,
            $vars: [],
            name: 'Jan 2, 2024',
            data: { total_cost: 10, total_price: '2.50' },
          },
          'tooltip-ticket',
        ),
      ).toContain('~$2.50')
    })
  })
})
