import {
  buildChartOptions,
  formatChartSummaryValue,
  getChartSummaryValue,
  getChartValueKey,
  getChartValues,
  getDefaultChartData,
  getStatisticNumber,
  getTotalPriceValue,
  isChartDataEmpty,
} from '../utils'

describe('app-chart-utils', () => {
  it('should build default chart data for the provided range and key', () => {
    expect(getDefaultChartData({
      start: '2026-03-01',
      end: '2026-03-03',
      key: 'runs',
    })).toEqual([
      { date: 'Mar 1, 2026', runs: 0 },
      { date: 'Mar 2, 2026', runs: 0 },
    ])
  })

  it('should keep a single zero-value point when start and end are the same day', () => {
    expect(getDefaultChartData({
      start: '2026-03-01',
      end: '2026-03-01',
    })).toEqual([
      { date: 'Mar 1, 2026', count: 0 },
    ])
  })

  it('should resolve chart keys and summary values', () => {
    const statistics = [
      { date: 'Mar 1, 2026', message_count: 2, total_price: 1.2 },
      { date: 'Mar 2, 2026', message_count: 4, total_price: 2.3 },
    ]

    expect(getChartValueKey(statistics, undefined)).toBe('message_count')
    expect(getChartSummaryValue(statistics, 'message_count', false)).toBe(6)
    expect(getChartSummaryValue(statistics, 'message_count', true)).toBe(3)
    expect(getTotalPriceValue(statistics)).toBe(3.5)
  })

  it('should parse numeric and invalid statistic values safely', () => {
    const statistic = {
      date: 'Mar 1, 2026',
      numeric: 4,
      decimalString: '3.5',
      invalidString: 'n/a',
    }

    expect(getStatisticNumber(statistic, 'numeric')).toBe(4)
    expect(getStatisticNumber(statistic, 'decimalString')).toBe(3.5)
    expect(getStatisticNumber(statistic, 'invalidString')).toBe(0)
    expect(getStatisticNumber(statistic, 'missing')).toBe(0)
    expect(getChartValues([statistic], 'decimalString')).toEqual([3.5])
  })

  it('should fall back to empty states when statistics are missing', () => {
    expect(getChartValueKey([], undefined)).toBe('count')
    expect(getChartSummaryValue([], 'message_count')).toBe(0)
    expect(isChartDataEmpty()).toBe(true)
    expect(isChartDataEmpty({ data: [] })).toBe(true)
    expect(isChartDataEmpty({ data: [{ date: 'Mar 1, 2026', count: 1 }] })).toBe(false)
  })

  it('should format summary values for cost and non-cost charts', () => {
    expect(formatChartSummaryValue({
      chartType: 'messages',
      summaryValue: 1200,
      unit: 'ms',
    })).toBe('1,200 ms')

    expect(formatChartSummaryValue({
      chartType: 'costs',
      summaryValue: 999,
    })).toBe('999')

    expect(formatChartSummaryValue({
      chartType: 'costs',
      summaryValue: 1500,
    })).toBe('2k')
  })

  it('should build chart options with token tooltip support', () => {
    const options = buildChartOptions({
      chartType: 'costs',
      statistics: [
        { date: '2026-03-01', token_count: 1200, total_price: 1.2345 },
      ],
      valueKey: 'token_count',
      yMax: 100,
    })

    expect(options.dataset).toEqual({
      dimensions: ['date', 'token_count'],
      source: [{ date: '2026-03-01', token_count: 1200, total_price: 1.2345 }],
    })
    expect(options.yAxis).toMatchObject({ max: 100, type: 'value' })

    const series = Array.isArray(options.series) ? options.series[0] : undefined
    expect(series).toMatchObject({
      type: 'line',
      symbolSize: 4,
    })

    const formatter = typeof series === 'object' && series && 'tooltip' in series
      ? (series.tooltip as { formatter?: (params: { name: string, data: Record<string, string | number> }) => string }).formatter
      : undefined

    expect(formatter?.({
      name: '2026-03-01',
      data: {
        date: '2026-03-01',
        token_count: 1200,
        total_price: 1.2345,
      },
    })).toContain('~$1.2345')
  })

  it('should expose axis formatters and split-line intervals for the chart grid', () => {
    const options = buildChartOptions({
      chartType: 'messages',
      statistics: [
        { date: '2026-03-01', message_count: 1 },
        { date: '2026-03-02', message_count: 2 },
        { date: '2026-03-03', message_count: 3 },
      ],
      valueKey: 'message_count',
    })

    const xAxes = Array.isArray(options.xAxis) ? options.xAxis : []
    const primaryAxis = xAxes[0]
    const secondaryAxis = xAxes[1]
    const primaryLabelFormatter = typeof primaryAxis === 'object'
      ? primaryAxis.axisLabel?.formatter as ((value: string) => string) | undefined
      : undefined
    const primaryInterval = typeof primaryAxis === 'object'
      ? primaryAxis.splitLine?.interval as ((index: number) => boolean) | undefined
      : undefined
    const secondaryInterval = typeof secondaryAxis === 'object'
      ? secondaryAxis.splitLine?.interval as ((index: number, value: string) => boolean) | undefined
      : undefined

    expect(primaryLabelFormatter?.('2026-03-01')).toBe('Mar 1, 2026')
    expect(primaryInterval?.(0)).toBe(true)
    expect(primaryInterval?.(1)).toBe(false)
    expect(primaryInterval?.(2)).toBe(true)
    expect(secondaryInterval?.(0, '1')).toBe(true)
    expect(secondaryInterval?.(0, '')).toBe(false)
  })
})
