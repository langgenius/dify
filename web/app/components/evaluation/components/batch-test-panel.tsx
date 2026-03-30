'use client'

import type { EvaluationResourceProps } from '../types'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import Button from '@/app/components/base/button'
import { toast } from '@/app/components/base/ui/toast'
import { cn } from '@/utils/classnames'
import { getEvaluationMockConfig } from '../mock'
import { isEvaluationRunnable, useEvaluationResource, useEvaluationStore } from '../store'
import { TAB_CLASS_NAME } from '../utils'

const BatchTestPanel = ({
  resourceType,
  resourceId,
}: EvaluationResourceProps) => {
  const { t } = useTranslation('evaluation')
  const config = getEvaluationMockConfig(resourceType)
  const requirementFields = config.fieldOptions
    .filter(field => field.id.includes('.input.') || field.group.toLowerCase().includes('input'))
    .slice(0, 4)
  const displayedRequirementFields = requirementFields.length > 0 ? requirementFields : config.fieldOptions.slice(0, 4)
  const tabLabels = {
    'input-fields': t('batch.tabs.input-fields'),
    'history': t('batch.tabs.history'),
  }
  const statusLabels = {
    running: t('batch.status.running'),
    success: t('batch.status.success'),
    failed: t('batch.status.failed'),
  }
  const resource = useEvaluationResource(resourceType, resourceId)
  const setBatchTab = useEvaluationStore(state => state.setBatchTab)
  const setUploadedFileName = useEvaluationStore(state => state.setUploadedFileName)
  const runBatchTest = useEvaluationStore(state => state.runBatchTest)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isRunnable = isEvaluationRunnable(resource)
  const isPanelReady = !!resource.judgeModelId && resource.metrics.length > 0

  const handleDownloadTemplate = () => {
    const content = ['case_id,input,expected', '1,Example input,Example output'].join('\n')
    const link = document.createElement('a')
    link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(content)}`
    link.download = config.templateFileName
    link.click()
  }

  const handleRun = () => {
    if (!isRunnable) {
      toast.warning(t('batch.validation'))
      return
    }

    runBatchTest(resourceType, resourceId)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background-default">
      <div className="px-6 py-4">
        <div className="text-text-primary system-xl-semibold">{t('batch.title')}</div>
        <div className="mt-1 text-text-tertiary system-sm-regular">{t('batch.description')}</div>
        <div className="mt-4 rounded-xl border border-divider-subtle bg-components-card-bg p-3">
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="i-ri-alert-fill mt-0.5 h-4 w-4 shrink-0 text-text-warning" />
            <div className="text-text-tertiary system-xs-regular">{t('batch.noticeDescription')}</div>
          </div>
        </div>
      </div>
      <div className="border-b border-divider-subtle px-6">
        <div className="flex gap-4">
          {(['input-fields', 'history'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              className={cn(
                TAB_CLASS_NAME,
                'flex-none rounded-none border-b-2 border-transparent px-0 pb-2.5 pt-2 uppercase',
                resource.activeBatchTab === tab ? 'border-text-accent-secondary text-text-primary' : 'text-text-tertiary',
              )}
              onClick={() => setBatchTab(resourceType, resourceId, tab)}
            >
              {tabLabels[tab]}
            </button>
          ))}
        </div>
      </div>
      <div className={cn('min-h-0 flex-1 overflow-y-auto px-6 py-4', !isPanelReady && 'opacity-50')}>
        {resource.activeBatchTab === 'input-fields' && (
          <div className="space-y-5">
            <div>
              <div className="text-text-primary system-md-semibold">{t('batch.requirementsTitle')}</div>
              <div className="mt-1 text-text-tertiary system-xs-regular">{t('batch.requirementsDescription')}</div>
              <div className="mt-3 rounded-xl bg-background-section p-3">
                {displayedRequirementFields.map(field => (
                  <div key={field.id} className="flex items-center py-1">
                    <div className="rounded px-1 py-0.5 text-text-tertiary system-xs-medium">
                      {field.label}
                    </div>
                    <div className="text-[10px] leading-3 text-text-quaternary">
                      {field.type}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <Button variant="secondary" className="w-full justify-center" disabled={!isPanelReady} onClick={handleDownloadTemplate}>
                <span aria-hidden="true" className="i-ri-download-line mr-1 h-4 w-4" />
                {t('batch.downloadTemplate')}
              </Button>
              <input
                ref={fileInputRef}
                hidden
                type="file"
                accept=".csv,.xlsx"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  setUploadedFileName(resourceType, resourceId, file?.name ?? null)
                }}
              />
              {isPanelReady && (
                <button
                  type="button"
                  className="flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-divider-subtle bg-background-default-subtle px-4 py-6 text-center hover:border-components-button-secondary-border"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <span aria-hidden="true" className="i-ri-file-upload-line h-5 w-5 text-text-tertiary" />
                  <div className="mt-2 text-text-primary system-sm-semibold">{t('batch.uploadTitle')}</div>
                  <div className="mt-1 text-text-tertiary system-xs-regular">{resource.uploadedFileName ?? t('batch.uploadHint')}</div>
                </button>
              )}
            </div>
            {!isRunnable && (
              <div className="rounded-xl border border-divider-subtle bg-background-default-subtle px-3 py-2 text-text-tertiary system-xs-regular">
                {t('batch.validation')}
              </div>
            )}
            <Button className="w-full justify-center" variant="primary" disabled={!isRunnable} onClick={handleRun}>
              {t('batch.run')}
            </Button>
          </div>
        )}
        {resource.activeBatchTab === 'history' && (
          <div className="space-y-3">
            {resource.batchRecords.length === 0 && (
              <div className="rounded-2xl border border-dashed border-divider-subtle px-4 py-10 text-center text-text-tertiary system-sm-regular">
                {t('batch.emptyHistory')}
              </div>
            )}
            {resource.batchRecords.map(record => (
              <div key={record.id} className="rounded-2xl border border-divider-subtle bg-background-default-subtle p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-text-primary system-sm-semibold">{record.summary}</div>
                    <div className="mt-1 text-text-tertiary system-xs-regular">{record.fileName}</div>
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
                <div className="mt-3 text-text-tertiary system-xs-regular">{record.startedAt}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default BatchTestPanel
