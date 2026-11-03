'use client'

import type { EChartsOption } from 'echarts'
import type { z } from 'zod/v4'
import type { BarChartDefinition, LineChartDefinition } from '../registry/definitions'
import ReactECharts from 'echarts-for-react/esm/core'
import { memo, useEffect, useId, useRef, useState } from 'react'
import { useLocale, useTranslation } from '#i18n'
import { echarts } from '@/app/components/base/line-chart/echarts'
import useTheme from '@/hooks/use-theme'

type LineChartProps = z.infer<typeof LineChartDefinition.props>
type BarChartProps = z.infer<typeof BarChartDefinition.props>
type ChartPoint = LineChartProps['points'][number]
type ChartColors = { line: string; label: string; border: string; background: string }

function completePoints(points: ChartPoint[] | undefined) {
  // OpenUI renders incrementally, before the last point's label and value have arrived.
  return (
    points?.filter((point) => typeof point?.label === 'string' && Number.isFinite(point.value)) ??
    []
  )
}

function GeneratedChart({ title, points, unit, kind }: LineChartProps & { kind: 'line' | 'bar' }) {
  const { t } = useTranslation(['appDebug'])
  const locale = useLocale()
  const { theme } = useTheme()
  const titleId = useId()
  const frameRef = useRef<HTMLElement>(null)
  const seriesColorRef = useRef<HTMLSpanElement>(null)
  const [colors, setColors] = useState<ChartColors>()

  useEffect(() => {
    // ECharts parses colors in JavaScript. Resolve theme tokens to actual RGB colors
    // after the theme has been applied, rather than passing CSS var() expressions.
    const frame = requestAnimationFrame(() => {
      const frameStyle = getComputedStyle(frameRef.current!)
      setColors({
        line: getComputedStyle(seriesColorRef.current!).color,
        label: frameStyle.color,
        border: frameStyle.borderColor,
        background: frameStyle.backgroundColor,
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [theme])

  const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 20 })
  const data = completePoints(points)
  const categoryAxis = {
    type: 'category' as const,
    data: data.map((point) => point.label),
    axisTick: { show: false },
    axisLine: { show: false },
    axisLabel: {
      color: colors?.label,
      hideOverlap: true,
      width: kind === 'bar' ? 88 : 80,
      overflow: 'truncate' as const,
    },
  }
  const valueAxis = {
    type: 'value' as const,
    scale: false,
    axisLabel: { color: colors?.label, hideOverlap: true, formatter: numberFormat.format },
    splitLine: { lineStyle: { color: colors?.border, type: 'dashed' as const } },
  }
  const option: EChartsOption = {
    animation: false,
    grid: { top: 12, right: kind === 'bar' ? 48 : 12, bottom: 12, left: 12, containLabel: true },
    tooltip: {
      trigger: 'axis',
      renderMode: 'richText',
      confine: true,
      backgroundColor: colors?.background,
      borderColor: colors?.border,
      textStyle: { color: colors?.label },
      valueFormatter: (_value, index) =>
        `${numberFormat.format(data[index]!.value)}${unit ? ` ${unit}` : ''}`,
    },
    xAxis: kind === 'line' ? { ...categoryAxis, boundaryGap: false } : valueAxis,
    yAxis: kind === 'line' ? valueAxis : { ...categoryAxis, inverse: true },
    series: [
      kind === 'line'
        ? {
            type: 'line',
            data: data.map((point) => point.value),
            symbol: 'circle',
            symbolSize: 6,
            showSymbol: true,
            lineStyle: { color: colors?.line, width: 2.5 },
            itemStyle: { color: colors?.line },
            areaStyle: { color: colors?.line, opacity: 0.12 },
          }
        : {
            type: 'bar',
            data: data.map((point) => point.value),
            barMaxWidth: 24,
            itemStyle: { color: colors?.line, borderRadius: 2 },
            label: {
              show: true,
              position: 'outside',
              color: colors?.label,
              formatter: ({ dataIndex }) => numberFormat.format(data[dataIndex]!.value),
            },
          },
    ],
  }
  const exactValues = (
    <dl className="mt-3 divide-y divide-divider-subtle system-sm-regular">
      {data.map((point, index) => (
        // oxlint-disable-next-line react/no-array-index-key -- Point rows follow series order and contain no stateful controls.
        <div key={index} className="flex justify-between gap-4 py-2">
          <dt className="min-w-0 wrap-break-word text-text-secondary">{point.label}</dt>
          <dd className="shrink-0 text-text-primary tabular-nums">
            {numberFormat.format(point.value)}
            {unit && ` ${unit}`}
          </dd>
        </div>
      ))}
    </dl>
  )

  return (
    <figure
      ref={frameRef}
      aria-labelledby={titleId}
      className="min-w-0 rounded-xl border border-components-panel-border bg-components-chart-bg p-4 text-text-tertiary"
    >
      <span ref={seriesColorRef} hidden className="text-components-chart-line" />
      <figcaption className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={titleId} className="system-md-semibold wrap-break-word text-text-primary">
          {title}
        </h3>
        {unit && <span className="system-xs-regular text-text-tertiary">{unit}</span>}
      </figcaption>
      {data.length === 0 ? (
        <p className="py-8 text-center system-sm-regular text-text-tertiary">
          {t(($) => $['generativeUI.chartEmpty'])}
        </p>
      ) : (
        <>
          <div aria-hidden="true" className="min-h-60" dir="ltr">
            {colors && (
              <ReactECharts
                echarts={echarts}
                option={option}
                opts={{ renderer: 'svg' }}
                notMerge
                lazyUpdate
                autoResize
                style={{
                  height: kind === 'bar' ? Math.max(240, data.length * 36) : 240,
                  width: '100%',
                }}
              />
            )}
          </div>
          {kind === 'line' ? (
            <details className="mt-4 border-t border-divider-subtle pt-3">
              <summary className="cursor-pointer rounded-sm system-xs-medium text-text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-accent">
                {t(($) => $['generativeUI.chartData'])}
              </summary>
              {exactValues}
            </details>
          ) : (
            exactValues
          )}
        </>
      )}
    </figure>
  )
}

// OpenUI broadcasts unrelated form edits to registered components. Keep the chart
// adapter stable so ECharts only updates when this chart's data or presentation changes.
export const GeneratedLineChart = memo((props: LineChartProps) => (
  <GeneratedChart {...props} kind="line" />
))

export const GeneratedBarChart = memo((props: BarChartProps) => (
  <GeneratedChart {...props} kind="bar" />
))
