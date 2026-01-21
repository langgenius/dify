'use client'
import type { FC } from 'react'
import type { QueryParam } from './index'
import type { I18nKeysByPrefix } from '@/types/i18n'
import { RiBracesLine, RiCalendarLine, RiFileTextLine } from '@remixicon/react'
import dayjs from 'dayjs'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude/utils'
import Button from '@/app/components/base/button'
import Chip from '@/app/components/base/chip'
import { FileDownload02 } from '@/app/components/base/icons/src/vender/line/files'
import Input from '@/app/components/base/input'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { exportWorkflowLogs } from '@/service/use-log'

dayjs.extend(quarterOfYear)

const today = dayjs()

type TimePeriodName = I18nKeysByPrefix<'appLog', 'filter.period.'>

export const TIME_PERIOD_MAPPING: { [key: string]: { value: number, name: TimePeriodName } } = {
  1: { value: 0, name: 'today' },
  2: { value: 7, name: 'last7days' },
  3: { value: 28, name: 'last4weeks' },
  4: { value: today.diff(today.subtract(3, 'month'), 'day'), name: 'last3months' },
  5: { value: today.diff(today.subtract(12, 'month'), 'day'), name: 'last12months' },
  6: { value: today.diff(today.startOf('month'), 'day'), name: 'monthToDate' },
  7: { value: today.diff(today.startOf('quarter'), 'day'), name: 'quarterToDate' },
  8: { value: today.diff(today.startOf('year'), 'day'), name: 'yearToDate' },
  9: { value: -1, name: 'allTime' },
}

type IFilterProps = {
  queryParams: QueryParam
  setQueryParams: (v: QueryParam) => void
  appId: string
  timezone?: string
}

type ExportFormat = 'csv' | 'json'

const FILTER_FORMAT_OPTIONS: { value: ExportFormat, nameKey: I18nKeysByPrefix<'common', 'operation.exportFormat.'>, icon: React.ReactNode }[] = [
  { value: 'csv', nameKey: 'csv', icon: <RiFileTextLine className="h-4 w-4" /> },
  { value: 'json', nameKey: 'jsonl', icon: <RiBracesLine className="h-4 w-4" /> },
]

const Filter: FC<IFilterProps> = ({ queryParams, setQueryParams, appId, timezone }: IFilterProps) => {
  const { t } = useTranslation()
  const [isExporting, setIsExporting] = React.useState(false)
  const [exportFormat, setExportFormat] = React.useState<ExportFormat>('csv')
  const [showFormatMenu, setShowFormatMenu] = React.useState(false)

  const formatOptions = FILTER_FORMAT_OPTIONS.map(opt => ({
    ...opt,
    name: t(`operation.exportFormat.${opt.nameKey}`, { ns: 'common' }),
  }))
  const selectedFormatOption = formatOptions.find(opt => opt.value === exportFormat)

  const handleExport = async (formatOverride?: ExportFormat) => {
    setIsExporting(true)
    setShowFormatMenu(false)
    const formatToUse = formatOverride || exportFormat

    // Calculate date range based on period
    const tz = timezone || dayjs.tz.guess()
    const dateParams = queryParams.period !== '9'
      ? {
          created_at__after: dayjs().subtract(TIME_PERIOD_MAPPING[queryParams.period].value, 'day').startOf('day').tz(tz).format(),
          created_at__before: dayjs().endOf('day').tz(tz).format(),
        }
      : {}

    try {
      trackEvent('workflow_log_export_clicked', { format: formatToUse })
      await exportWorkflowLogs({
        appId,
        params: {
          ...(queryParams.status !== 'all' ? { status: queryParams.status } : {}),
          ...(queryParams.keyword ? { keyword: queryParams.keyword } : {}),
          ...dateParams,
          format: formatToUse,
        },
      })
    }
    catch (error) {
      console.error('Failed to export workflow logs:', error)
    }
    finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="mb-2 flex flex-row flex-wrap items-center gap-2">
      <Chip
        value={queryParams.status || 'all'}
        onSelect={(item) => {
          setQueryParams({ ...queryParams, status: item.value as string })
          trackEvent('workflow_log_filter_status_selected', {
            workflow_log_filter_status: item.value as string,
          })
        }}
        onClear={() => setQueryParams({ ...queryParams, status: 'all' })}
        items={[
          { value: 'all', name: 'All' },
          { value: 'succeeded', name: 'Success' },
          { value: 'failed', name: 'Fail' },
          { value: 'stopped', name: 'Stop' },
          { value: 'partial-succeeded', name: 'Partial Success' },
        ]}
      />
      <Chip
        className="min-w-[150px]"
        panelClassName="w-[270px]"
        leftIcon={<RiCalendarLine className="h-4 w-4 text-text-secondary" />}
        value={queryParams.period}
        onSelect={(item) => {
          setQueryParams({ ...queryParams, period: item.value })
        }}
        onClear={() => setQueryParams({ ...queryParams, period: '9' })}
        items={Object.entries(TIME_PERIOD_MAPPING).map(([k, v]) => ({ value: k, name: t(`filter.period.${v.name}`, { ns: 'appLog' }) }))}
      />
      <Input
        wrapperClassName="w-[200px]"
        showLeftIcon
        showClearIcon
        value={queryParams.keyword ?? ''}
        placeholder={t('operation.search', { ns: 'common' })!}
        onChange={(e) => {
          setQueryParams({ ...queryParams, keyword: e.target.value })
        }}
        onClear={() => setQueryParams({ ...queryParams, keyword: '' })}
      />
      <PortalToFollowElem
        open={showFormatMenu}
        onOpenChange={setShowFormatMenu}
        placement="bottom-end"
      >
        <PortalToFollowElemTrigger onClick={() => setShowFormatMenu(!showFormatMenu)}>
          <Button
            variant="secondary"
            className="gap-1"
            disabled={isExporting}
          >
            <FileDownload02 className="h-4 w-4" />
            {isExporting
              ? t('operation.exporting', { ns: 'common' })
              : t('operation.export', { ns: 'common' })}
            <span className="ml-0.5 text-xs text-text-tertiary">
              (
              {selectedFormatOption?.name}
              )
            </span>
          </Button>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className="z-50">
          <div className="relative w-[160px] rounded-lg border border-components-panel-border-subtle bg-components-panel-bg-blur p-1 shadow-lg">
            {formatOptions.map(option => (
              <div
                key={option.value}
                className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-text-primary hover:bg-components-input-bg-hover"
                onClick={() => {
                  setExportFormat(option.value)
                  handleExport(option.value)
                }}
              >
                {option.icon}
                <span>{option.name}</span>
              </div>
            ))}
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </div>
  )
}

export default Filter
