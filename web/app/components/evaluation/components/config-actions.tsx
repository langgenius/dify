'use client'

import type { EvaluationResourceProps } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { useTranslation } from 'react-i18next'
import { useSaveEvaluationConfigMutation } from '@/service/use-evaluation'
import {
  isEvaluationRunnable,
  useEvaluationResource,
  useEvaluationStore,
  useIsEvaluationConfigDirty,
} from '../store'
import { buildEvaluationConfigPayload } from '../store-utils'

const EvaluationConfigActions = ({
  resourceType,
  resourceId,
}: EvaluationResourceProps) => {
  const { t } = useTranslation('evaluation')
  const { t: tCommon } = useTranslation('common')
  const resource = useEvaluationResource(resourceType, resourceId)
  const isDirty = useIsEvaluationConfigDirty(resourceType, resourceId)
  const resetResourceConfig = useEvaluationStore(state => state.resetResourceConfig)
  const markResourceConfigSaved = useEvaluationStore(state => state.markResourceConfigSaved)
  const saveConfigMutation = useSaveEvaluationConfigMutation()
  const isRunnable = isEvaluationRunnable(resource)

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
        markResourceConfigSaved(resourceType, resourceId)
        toast.success(tCommon('api.saved'))
      },
      onError: () => {
        toast.error(t('config.saveFailed'))
      },
    })
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button
        variant="secondary"
        disabled={!isDirty || saveConfigMutation.isPending}
        onClick={() => resetResourceConfig(resourceType, resourceId)}
      >
        {tCommon('operation.reset')}
      </Button>
      <Button
        variant="primary"
        disabled={!isRunnable}
        loading={saveConfigMutation.isPending}
        onClick={handleSave}
      >
        {tCommon('operation.save')}
      </Button>
    </div>
  )
}

export default EvaluationConfigActions
