'use client'

import type { z } from 'zod/v4'
import type { MetricCardDefinition } from '../registry/definitions'
import { cn } from '@langgenius/dify-ui/cn'
import { useId } from 'react'
import { useTranslation } from '#i18n'

export function GeneratedMetricCard({
  title,
  value,
  previousValue,
  unit,
  comparisonLabel,
  higherIsBetter = true,
}: z.infer<typeof MetricCardDefinition.props>) {
  const { t, i18n } = useTranslation(['appDebug'])
  const titleId = useId()
  // A streamed component can arrive before its numeric arguments are complete.
  const isComplete = Number.isFinite(value) && Number.isFinite(previousValue)
  const numberFormat = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 20 })
  const change = isComplete ? value - previousValue : 0
  const isComparable = isComplete && (previousValue !== 0 || value === 0)
  const rate = previousValue === 0 ? 0 : change / Math.abs(previousValue)
  const isImproved = change !== 0 && (higherIsBetter ? change > 0 : change < 0)
  const status =
    change === 0
      ? t(($) => $['generativeUI.metricUnchanged'])
      : isImproved
        ? t(($) => $['generativeUI.metricImproved'])
        : t(($) => $['generativeUI.metricDeclined'])

  return (
    <figure
      aria-labelledby={titleId}
      className="min-w-0 rounded-xl border border-components-panel-border bg-components-panel-bg p-5"
    >
      <figcaption id={titleId} className="system-sm-medium text-text-secondary">
        {title}
      </figcaption>
      {isComplete ? (
        <>
          <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <data
              value={value}
              className="min-w-0 text-3xl leading-tight font-semibold tracking-tight wrap-anywhere text-text-primary tabular-nums"
            >
              {numberFormat.format(value)}
            </data>
            {unit && <span className="system-md-regular text-text-tertiary">{unit}</span>}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="system-xs-regular text-text-tertiary">
              {comparisonLabel ?? t(($) => $['generativeUI.metricComparison'])}
            </span>
            {isComparable ? (
              <span
                className={cn(
                  'inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md px-2 py-1 system-xs-medium tabular-nums',
                  change === 0
                    ? 'bg-background-section-burn text-text-secondary'
                    : isImproved
                      ? 'bg-state-success-hover text-text-success'
                      : 'bg-state-destructive-hover text-text-destructive',
                )}
              >
                <span>
                  {new Intl.NumberFormat(i18n.language, {
                    style: 'percent',
                    maximumFractionDigits: 1,
                    signDisplay: 'exceptZero',
                  }).format(rate)}
                </span>
                <span>{status}</span>
              </span>
            ) : (
              <span className="system-xs-regular text-text-tertiary">
                {t(($) => $['generativeUI.metricUnavailable'])}
              </span>
            )}
          </div>
          <p className="mt-2 system-xs-regular wrap-anywhere text-text-tertiary tabular-nums">
            {t(($) => $['generativeUI.metricPrevious'])}
            {': '}
            {numberFormat.format(previousValue)}
            {unit && ` ${unit}`}
          </p>
        </>
      ) : (
        <p role="status" className="mt-4 body-sm-regular text-text-tertiary">
          {t(($) => $['generativeUI.loading'])}
        </p>
      )}
    </figure>
  )
}
