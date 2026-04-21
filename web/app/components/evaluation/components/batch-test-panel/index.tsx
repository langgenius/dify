'use client'

import type { BatchTestTab, EvaluationResourceProps } from '../../types'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { useSaveEvaluationConfigMutation } from '@/service/use-evaluation'
import { isEvaluationRunnable, useEvaluationResource, useEvaluationStore } from '../../store'
import { buildEvaluationConfigPayload } from '../../store-utils'
import { TAB_CLASS_NAME } from '../../utils'
import HistoryTab from './history-tab'
import InputFieldsTab from './input-fields-tab'

const BATCH_TABS: BatchTestTab[] = ['input-fields', 'history']

const BatchTestPanel = ({
  resourceType,
  resourceId,
}: EvaluationResourceProps) => {
  const { t } = useTranslation('evaluation')
  const { t: tCommon } = useTranslation('common')
  const tabLabels: Record<BatchTestTab, string> = {
    'input-fields': t('batch.tabs.input-fields'),
    'history': t('batch.tabs.history'),
  }
  const resource = useEvaluationResource(resourceType, resourceId)
  const setBatchTab = useEvaluationStore(state => state.setBatchTab)
  const saveConfigMutation = useSaveEvaluationConfigMutation()
  const isRunnable = isEvaluationRunnable(resource)
  const isPanelReady = !!resource.judgeModelId && resource.metrics.length > 0

  const handleSave = () => {
    if (!isRunnable) {
      toast.warning(t('batch.validation'))
      return
    }

    const body = buildEvaluationConfigPayload(resource, resourceType)

    if (!body) {
      toast.warning(t('batch.validation'))
      return
    }

    saveConfigMutation.mutate({
      params: {
        targetType: resourceType,
        targetId: resourceId,
      },
      body,
    }, {
      onSuccess: () => {
        toast.success(tCommon('api.saved'))
      },
      onError: () => {
        toast.error(t('config.saveFailed'))
      },
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background-default">
      <div className="px-6 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="system-xl-semibold text-text-primary">{t('batch.title')}</div>
            <div className="system-sm-regular mt-1 text-text-tertiary">{t('batch.description')}</div>
          </div>
          <Button
            className="shrink-0"
            variant="primary"
            disabled={!isRunnable}
            loading={saveConfigMutation.isPending}
            onClick={handleSave}
          >
            {tCommon('operation.save')}
          </Button>
        </div>
        <div className="mt-4 rounded-xl border border-divider-subtle bg-components-card-bg p-3">
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="mt-0.5 i-ri-alert-fill h-4 w-4 shrink-0 text-text-warning" />
            <div className="system-xs-regular text-text-tertiary">{t('batch.noticeDescription')}</div>
          </div>
        </div>
      </div>
      <div className="border-b border-divider-subtle px-6">
        <div className="flex gap-4">
          {BATCH_TABS.map(tab => (
            <button
              key={tab}
              type="button"
              className={cn(
                TAB_CLASS_NAME,
                'flex-none rounded-none border-b-2 border-transparent px-0 pt-2 pb-2.5 uppercase',
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
          <InputFieldsTab
            resourceType={resourceType}
            resourceId={resourceId}
            isPanelReady={isPanelReady}
            isRunnable={isRunnable}
          />
        )}
        {resource.activeBatchTab === 'history' && <HistoryTab resourceType={resourceType} resourceId={resourceId} />}
      </div>
    </div>
  )
}

export default BatchTestPanel
