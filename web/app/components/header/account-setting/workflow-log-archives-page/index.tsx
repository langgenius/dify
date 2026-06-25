'use client'

import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'

type WorkflowArchiveMonth = {
  key: string
  month: string
  runCount: string
  archiveFileCount: number
  size: string
}

const archiveMonths: WorkflowArchiveMonth[] = [
  {
    key: '2025-03',
    month: '2025-03',
    runCount: '18,900',
    archiveFileCount: 2,
    size: '16.2 MB',
  },
  {
    key: '2025-02',
    month: '2025-02',
    runCount: '8,730',
    archiveFileCount: 1,
    size: '7.5 MB',
  },
  {
    key: '2025-01',
    month: '2025-01',
    runCount: '21,440',
    archiveFileCount: 3,
    size: '18.6 MB',
  },
]

const tableGridClassName = 'grid-cols-[0.8fr_0.8fr_0.8fr_0.8fr_0.9fr]'

export default function WorkflowLogArchivesPage() {
  const { t } = useTranslation()

  const summaryItems = [
    {
      label: t('archives.summary.months', { ns: 'appLog' }),
      value: '6',
      icon: 'i-ri-calendar-2-line',
      accentClassName: 'bg-util-colors-blue-blue-500',
      iconClassName: 'border-util-colors-blue-blue-200 bg-util-colors-blue-blue-50 text-util-colors-blue-blue-600',
    },
    {
      label: t('archives.summary.runs', { ns: 'appLog' }),
      value: '61,070',
      icon: 'i-ri-git-branch-line',
      accentClassName: 'bg-util-colors-green-green-500',
      iconClassName: 'border-util-colors-green-green-200 bg-util-colors-green-green-50 text-util-colors-green-green-600',
    },
    {
      label: t('archives.summary.size', { ns: 'appLog' }),
      value: '51.4 MB',
      icon: 'i-ri-hard-drive-2-line',
      accentClassName: 'bg-util-colors-warning-warning-500',
      iconClassName: 'border-util-colors-warning-warning-200 bg-util-colors-warning-warning-50 text-util-colors-warning-warning-600',
    },
    {
      label: t('archives.summary.latest', { ns: 'appLog' }),
      value: '2025-03-03',
      icon: 'i-ri-time-line',
      accentClassName: 'bg-util-colors-orange-orange-500',
      iconClassName: 'border-util-colors-orange-orange-200 bg-util-colors-orange-orange-50 text-util-colors-orange-orange-600',
    },
  ]

  return (
    <div data-testid="workflow-log-archives-page" className="flex flex-col gap-4 pb-6">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {summaryItems.map(item => (
          <div key={item.label} className="relative flex min-h-28 flex-col overflow-hidden rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg p-4 shadow-xs shadow-shadow-shadow-3">
            <div className={cn('absolute inset-x-0 top-0 h-1', item.accentClassName)} />
            <div className="flex items-start justify-between gap-3 pt-1">
              <div className="min-h-8 min-w-0 system-xs-medium-uppercase text-text-tertiary">{item.label}</div>
              <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl border-[0.5px] shadow-xs', item.iconClassName)}>
                <span className={cn(item.icon, 'size-5')} aria-hidden="true" />
              </div>
            </div>
            <div className="mt-auto title-2xl-semi-bold whitespace-nowrap text-text-primary">{item.value}</div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg shadow-xs">
        <div className="overflow-x-auto">
          <div className="min-w-[520px]">
            <div className={cn('grid h-8 items-center gap-3 border-b border-divider-subtle bg-background-section-burn px-4 system-xs-medium-uppercase text-text-tertiary', tableGridClassName)}>
              <div className="text-center">{t('archives.table.month', { ns: 'appLog' })}</div>
              <div className="text-center">{t('archives.table.runs', { ns: 'appLog' })}</div>
              <div className="text-center">{t('archives.table.files', { ns: 'appLog' })}</div>
              <div className="text-center">{t('archives.table.size', { ns: 'appLog' })}</div>
              <div className="text-center">{t('archives.table.action', { ns: 'appLog' })}</div>
            </div>
            {archiveMonths.map(archive => (
              <div
                key={archive.key}
                className={cn('grid min-h-15 items-center gap-3 border-b border-divider-subtle px-4 py-3 last:border-b-0', tableGridClassName)}
              >
                <div className="min-w-0 text-center">
                  <span className="truncate system-sm-semibold text-text-primary">{archive.month}</span>
                </div>
                <div className="text-center system-sm-medium text-text-secondary tabular-nums">{archive.runCount}</div>
                <div className="text-center system-sm-medium text-text-secondary tabular-nums">
                  {t('archives.table.fileCount', { ns: 'appLog', count: archive.archiveFileCount })}
                </div>
                <div className="text-center system-sm-medium text-text-secondary tabular-nums">{archive.size}</div>
                <div className="flex justify-center">
                  <Button
                    size="small"
                    variant="secondary"
                    className="gap-1 px-2"
                    aria-label={t('archives.action.downloadMonth', { ns: 'appLog', month: archive.month })}
                    onClick={() => undefined}
                  >
                    <span className="i-ri-download-2-line size-3.5" aria-hidden="true" />
                    {t('operation.download', { ns: 'common' })}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
