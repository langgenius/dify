import type { BatchTestRecord } from '../../types'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'

type HistoryTabProps = {
  batchRecords: BatchTestRecord[]
}

const HistoryTab = ({ batchRecords }: HistoryTabProps) => {
  const { t } = useTranslation('evaluation')
  const statusLabels = {
    running: t('batch.status.running'),
    success: t('batch.status.success'),
    failed: t('batch.status.failed'),
  }

  return (
    <div className="space-y-3">
      {batchRecords.length === 0 && (
        <div className="rounded-2xl border border-dashed border-divider-subtle px-4 py-10 text-center system-sm-regular text-text-tertiary">
          {t('batch.emptyHistory')}
        </div>
      )}
      {batchRecords.map(record => (
        <div key={record.id} className="rounded-2xl border border-divider-subtle bg-background-default-subtle p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="system-sm-semibold text-text-primary">{record.summary}</div>
              <div className="mt-1 system-xs-regular text-text-tertiary">{record.fileName}</div>
            </div>
            <Badge className={record.status === 'failed' ? 'badge-warning' : record.status === 'success' ? 'badge-accent' : ''}>
              {record.status === 'running'
                ? (
                    <span className="flex items-center gap-1">
                      <span aria-hidden="true" className="i-ri-loader-4-line h-3 w-3 animate-spin" />
                      {statusLabels.running}
                    </span>
                  )
                : statusLabels[record.status]}
            </Badge>
          </div>
          <div className="mt-3 system-xs-regular text-text-tertiary">{record.startedAt}</div>
        </div>
      ))}
    </div>
  )
}

export default HistoryTab
