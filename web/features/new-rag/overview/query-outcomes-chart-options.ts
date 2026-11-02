import type { KnowledgeFsOverviewQueryOutcomeBucketResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { EChartsOption } from 'echarts'

type QueryOutcomeLabels = {
  answered: string
  lowConfidence: string
  noEvidence: string
}

export function buildQueryOutcomesChartOptions({
  buckets,
  labels,
  locale,
}: {
  buckets: KnowledgeFsOverviewQueryOutcomeBucketResponse[]
  labels: QueryOutcomeLabels
  locale: string
}): EChartsOption {
  const dailyBuckets =
    buckets.length > 1 &&
    new Date(buckets[1]!.start_at).getTime() - new Date(buckets[0]!.start_at).getTime() >=
      12 * 60 * 60 * 1000
  const dateLabel = (date: string) =>
    Intl.DateTimeFormat(locale, {
      day: 'numeric',
      hour: dailyBuckets ? undefined : 'numeric',
      month: dailyBuckets ? 'short' : undefined,
    }).format(new Date(date))

  return {
    animationDuration: 250,
    color: ['#0033ff', '#bdb4fe', '#f79009'],
    grid: { bottom: 18, containLabel: true, left: 0, right: 24, top: 42 },
    legend: {
      icon: 'circle',
      itemHeight: 7,
      itemWidth: 7,
      right: 0,
      textStyle: { color: '#6b7280', fontSize: 11 },
      top: 0,
    },
    series: [
      {
        areaStyle: { opacity: 0.08 },
        data: buckets.map((bucket) => bucket.answered),
        name: labels.answered,
        showSymbol: true,
        smooth: false,
        symbolSize: 6,
        type: 'line',
      },
      {
        data: buckets.map((bucket) => bucket.low_confidence),
        name: labels.lowConfidence,
        showSymbol: true,
        smooth: false,
        symbolSize: 5,
        type: 'line',
      },
      {
        data: buckets.map((bucket) => bucket.no_evidence),
        name: labels.noEvidence,
        showSymbol: true,
        smooth: false,
        symbolSize: 5,
        type: 'line',
      },
    ],
    tooltip: { confine: true, trigger: 'item' },
    xAxis: {
      axisLabel: { color: '#9ca3af', fontSize: 10, hideOverlap: true },
      axisLine: { lineStyle: { color: '#e5e7eb' } },
      axisTick: { show: false },
      boundaryGap: false,
      data: buckets.map((bucket) => dateLabel(bucket.start_at)),
      type: 'category',
    },
    yAxis: {
      axisLabel: { color: '#9ca3af', fontSize: 10 },
      axisLine: { show: false },
      minInterval: 1,
      splitNumber: 4,
      splitLine: { lineStyle: { color: '#eef0f3', type: 'dashed' } },
      type: 'value',
    },
  }
}
