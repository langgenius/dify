import type { EvaluationRunItemResponse as EvaluationRunItem } from '@dify/contracts/api/console/evaluate-target-type/types.gen'
import type { MetricColumn } from './pipeline-results-utils'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useTranslation } from 'react-i18next'
import { Markdown } from '@/app/components/base/markdown'
import {
  formatExpectedOutput,
  formatValue,
  getIsItemPassed,
  getMetricValue,
  getQueryContent,
  toPlainTextPreview,
} from './pipeline-results-utils'

const LOADING_ROW_IDS = ['1', '2', '3', '4', '5', '6']

type ResultCellValueProps = {
  value: string
  label: string
  viewDetailsLabel: string
  isPlaceholder?: boolean
  /** Model output: preview it as plain text and render the full value as Markdown. */
  isMarkdown?: boolean
}

const ResultCellValue = ({
  value,
  label,
  viewDetailsLabel,
  isPlaceholder,
  isMarkdown,
}: ResultCellValueProps) => {
  if (isPlaceholder || value === '-') return <div className="wrap-anywhere">{value}</div>

  // Evaluation values may be multiline or unbounded; the popover owns their full disclosure.
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        openOnHover
        delay={200}
        closeDelay={200}
        aria-label={`${viewDetailsLabel}: ${label}`}
        className="block w-full min-w-0 cursor-pointer rounded-sm text-start"
      >
        <span className="line-clamp-2 wrap-anywhere">
          {isMarkdown ? toPlainTextPreview(value) : value}
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="max-h-[min(60dvh,480px)] w-max max-w-[min(560px,calc(100vw-2rem))] overflow-y-auto overscroll-contain p-3"
      >
        <PopoverTitle className="system-xs-semibold text-text-primary">{label}</PopoverTitle>
        {isMarkdown ? (
          <Markdown className="mt-2 system-sm-regular wrap-anywhere" content={value} />
        ) : (
          <div className="mt-2 system-sm-regular wrap-anywhere whitespace-pre-wrap text-text-secondary">
            {value}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

type PipelineResultsTableProps = {
  items: EvaluationRunItem[]
  metricColumns: MetricColumn[]
  isLoading: boolean
}

const PipelineResultsTable = ({ items, metricColumns, isLoading }: PipelineResultsTableProps) => {
  const { t } = useTranslation(['evaluation', 'common'])
  const viewDetailsLabel = t(($) => $['operation.viewDetails'], { ns: 'common' })
  const queryLabel = t(($) => $['results.columns.query'])
  const expectedLabel = t(($) => $['results.columns.expected'])
  const actualLabel = t(($) => $['results.columns.actual'])

  return (
    <div className="min-h-0 flex-1 overflow-auto py-2">
      <table className="min-w-full table-fixed border-collapse overflow-hidden rounded-lg">
        <colgroup>
          <col className="w-10" />
          <col className="w-[220px]" />
          <col className="w-[190px]" />
          <col className="w-[220px]" />
          {metricColumns.map((column) => (
            <col key={column.id} className="w-24" />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-background-section">
            <th className="h-7 rounded-s-lg" />
            <th className="h-7 px-3 text-start system-xs-medium-uppercase text-text-tertiary">
              {queryLabel}
            </th>
            <th className="h-7 px-3 text-start system-xs-medium-uppercase text-text-tertiary">
              {expectedLabel}
            </th>
            <th className="h-7 px-3 text-start system-xs-medium-uppercase text-text-tertiary">
              {actualLabel}
            </th>
            {metricColumns.map((column, index) => (
              <th
                key={column.id}
                className={cn(
                  'h-7 px-3 text-start system-xs-medium-uppercase text-text-tertiary',
                  index === metricColumns.length - 1 && 'rounded-e-lg',
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading &&
            LOADING_ROW_IDS.map((rowId) => (
              <tr key={rowId} className="border-b border-divider-subtle">
                <td colSpan={4 + metricColumns.length} className="h-10 px-3">
                  <div className="h-4 animate-pulse rounded bg-background-section" />
                </td>
              </tr>
            ))}
          {!isLoading &&
            items.map((item) => {
              const isPassed = getIsItemPassed(item)
              const actualOutput = item.error ?? item.actual_output
              const queryContent = getQueryContent(item)
              const expectedContent = formatExpectedOutput(item.expected_output)
              const actualContent = actualOutput
                ? formatValue(actualOutput)
                : t(($) => $['results.noResult'])

              return (
                <tr
                  key={item.id}
                  className="border-b border-divider-subtle even:bg-background-default-subtle"
                >
                  <td className="h-10 px-3 align-top">
                    <span
                      aria-label={
                        isPassed
                          ? t(($) => $['results.status.passed'])
                          : t(($) => $['results.status.failed'])
                      }
                      className={cn(
                        'mt-3 inline-block h-4 w-4',
                        isPassed
                          ? 'i-ri-check-line text-util-colors-green-green-600'
                          : 'i-ri-close-line text-util-colors-red-red-600',
                      )}
                    />
                  </td>
                  <td className="h-10 px-3 py-3 align-top system-sm-regular text-text-secondary">
                    <ResultCellValue
                      value={queryContent}
                      label={queryLabel}
                      viewDetailsLabel={viewDetailsLabel}
                    />
                  </td>
                  <td className="h-10 px-3 py-3 align-top system-sm-regular text-text-secondary">
                    <ResultCellValue
                      value={expectedContent}
                      label={expectedLabel}
                      viewDetailsLabel={viewDetailsLabel}
                    />
                  </td>
                  <td
                    className={cn(
                      'h-10 px-3 py-3 align-top system-sm-regular',
                      actualOutput ? 'text-text-secondary' : 'text-text-destructive',
                    )}
                  >
                    <ResultCellValue
                      value={actualContent}
                      label={actualLabel}
                      viewDetailsLabel={viewDetailsLabel}
                      isPlaceholder={!actualOutput}
                      isMarkdown={!item.error}
                    />
                  </td>
                  {metricColumns.map((column) => {
                    const metricValue = getMetricValue(item.metrics ?? [], column)

                    return (
                      <td
                        key={column.id}
                        className="h-10 px-3 py-3 align-top system-sm-regular text-text-secondary"
                      >
                        <ResultCellValue
                          value={formatValue(metricValue)}
                          label={column.label}
                          viewDetailsLabel={viewDetailsLabel}
                        />
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
