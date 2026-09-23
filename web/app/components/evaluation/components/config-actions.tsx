'use client'

import type { EvaluationResourceProps } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { useEvaluationActions } from '../queries'
import {
  isEvaluationRunnable,
  useEvaluationResource,
  useEvaluationStore,
  useIsEvaluationConfigDirty,
} from '../store'
import { buildEvaluationConfigPayload } from '../store-utils'

const EvaluationConfigActions = ({ resourceType, resourceId }: EvaluationResourceProps) => {
  const { t } = useTranslation('evaluation')
  const { t: tCommon } = useTranslation('common')
  const resource = useEvaluationResource(resourceType, resourceId)
  const isDirty = useIsEvaluationConfigDirty(resourceType, resourceId)
  const resetResourceConfig = useEvaluationStore((state) => state.resetResourceConfig)
  const markResourceConfigSaved = useEvaluationStore((state) => state.markResourceConfigSaved)
  const evaluationActions = useEvaluationActions({ resourceType, resourceId })
  const isRunnable = isEvaluationRunnable(resource)

  const handleSave = async () => {
    if (!isRunnable) {
      toast.warning(t(($) => $['batch.validation']))
      return
    }

    const body = buildEvaluationConfigPayload(resource, resourceType, resourceId)

    if (!body) {
      toast.warning(t(($) => $['batch.validation']))
      return
    }

    try {
      await evaluationActions.saveConfig(body)
      markResourceConfigSaved(resourceType, resourceId)
      toast.success(tCommon(($) => $['api.saved']))
    } catch {
      toast.error(t(($) => $['config.saveFailed']))
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button
        variant="secondary"
        disabled={!isDirty || evaluationActions.isSaving}
        onClick={() => resetResourceConfig(resourceType, resourceId)}
      >
        {tCommon(($) => $['operation.reset'])}
      </Button>
      <Button
        variant="primary"
        disabled={!isRunnable}
        loading={evaluationActions.isSaving}
        onClick={handleSave}
      >
        {tCommon(($) => $['operation.save'])}
      </Button>
    </div>
  )
}

export default EvaluationConfigActions
