import type { MetricColumn } from './pipeline-results-utils'
import type { EvaluationRunItem } from '@/types/evaluation'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import {
  formatValue,
  getIsItemPassed,
  getMetricTextClassName,
  getMetricValue,
  getQueryContent,
} from './pipeline-results-utils'

const LOADING_ROW_IDS = ['1', '2', '3', '4', '5', '6']

type PipelineResultsTableProps = {
  items: EvaluationRunItem[]
  metricColumns: MetricColumn[]
  isLoading: boolean
}

const PipelineResultsTable = ({
  items,
  metricColumns,
  isLoading,
}: PipelineResultsTableProps) => {
  const { t } = useTranslation('evaluation')

  return (
    <div className="overflow-x-auto py-2 xl:min-h-0 xl:flex-1 xl:overflow-auto">
      <table className="min-w-full table-fixed border-collapse overflow-hidden rounded-lg">
        <colgroup>
          <col className="w-10" />
          <col className="w-[220px]" />
          <col className="w-[190px]" />
          <col className="w-[220px]" />
          {metricColumns.map(column => <col key={column.id} className="w-24" />)}
        </colgroup>
        <thead>
          <tr className="bg-background-section">
            <th className="h-7 rounded-l-lg" />
            <th className="h-7 px-3 text-left system-xs-medium-uppercase text-text-tertiary">{t('results.columns.query')}</th>
            <th className="h-7 px-3 text-left system-xs-medium-uppercase text-text-tertiary">{t('results.columns.expected')}</th>
            <th className="h-7 px-3 text-left system-xs-medium-uppercase text-text-tertiary">{t('results.columns.actual')}</th>
            {metricColumns.map((column, index) => (
              <th
                key={column.id}
                className={cn(
                  'h-7 px-3 text-left system-xs-medium-uppercase text-text-tertiary',
                  index === metricColumns.length - 1 && 'rounded-r-lg',
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading && LOADING_ROW_IDS.map(rowId => (
            <tr key={rowId} className="border-b border-divider-subtle">
              <td colSpan={4 + metricColumns.length} className="h-10 px-3">
                <div className="h-4 animate-pulse rounded bg-background-section" />
              </td>
            </tr>
          ))}
          {!isLoading && items.map((item) => {
            const isPassed = getIsItemPassed(item, metricColumns)
            const actualOutput = item.error ?? item.actual_output

            return (
              <tr key={item.id} className="border-b border-divider-subtle even:bg-background-default-subtle">
                <td className="h-10 px-3 align-top">
                  <span
                    aria-label={isPassed ? t('results.status.passed') : t('results.status.failed')}
                    className={cn(
                      'mt-3 inline-block h-4 w-4',
                      isPassed
                        ? 'i-ri-check-line text-util-colors-green-green-600'
                        : 'i-ri-close-line text-util-colors-red-red-600',
                    )}
                  />
                </td>
                <td className="h-10 px-3 py-3 align-top system-sm-regular text-text-secondary">
                  <div className="line-clamp-2 break-words">{getQueryContent(item)}</div>
                </td>
                <td className="h-10 px-3 py-3 align-top system-sm-regular text-text-secondary">
                  <div className="line-clamp-2 break-words">{formatValue(item.expected_output)}</div>
                </td>
                <td className={cn(
                  'h-10 px-3 py-3 align-top system-sm-regular',
                  actualOutput ? 'text-text-secondary' : 'text-text-destructive',
                )}
                >
                  <div className="line-clamp-2 break-words">
                    {actualOutput ? formatValue(actualOutput) : t('results.noResult')}
                  </div>
                </td>
                {metricColumns.map((column) => {
                  const metricValue = getMetricValue(item.metrics, column)

                  return (
                    <td
                      key={column.id}
                      className={cn('h-10 px-3 py-3 align-top system-sm-regular', getMetricTextClassName(metricValue, column))}
                    >
                      {formatValue(metricValue)}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default PipelineResultsTable
