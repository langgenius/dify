'use client'

import type { EvaluationResourceProps } from './types'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import EvaluationLayout from './components/layout/evaluation-layout'
import EvaluationNodeNameNotice from './evaluation-node-name-notice'
import EvaluationTargetWorkflowGuard from './evaluation-target-workflow-guard'
import { useEvaluationConfigQuery } from './queries'
import { useEvaluationStore } from './store'

const EvaluationContent = ({ resourceType, resourceId }: EvaluationResourceProps) => {
  const { t } = useTranslation(['common'])
  const configQuery = useEvaluationConfigQuery({ resourceType, resourceId })
  const { data: config } = configQuery
  // Without the saved configuration the editor would start empty and saving would overwrite it.
  const configLoadErrorMessage = useRequestErrorMessage(config ? null : configQuery.error)
  const ensureResource = useEvaluationStore((state) => state.ensureResource)
  const hydrateResource = useEvaluationStore((state) => state.hydrateResource)

  useEffect(() => {
    ensureResource(resourceType, resourceId)
  }, [ensureResource, resourceId, resourceType])

  useEffect(() => {
    if (!config) return

    hydrateResource(resourceType, resourceId, config)
  }, [config, hydrateResource, resourceId, resourceType])

  if (configLoadErrorMessage) {
    return (
      <div className="p-6">
        <Alert type="error">
          <AlertTitle>{configLoadErrorMessage}</AlertTitle>
          <AlertActions>
            <Button
              size="small"
              loading={configQuery.isFetching}
              onClick={() => configQuery.refetch()}
            >
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          </AlertActions>
        </Alert>
      </div>
    )
  }

  return <EvaluationLayout resourceType={resourceType} resourceId={resourceId} />
}

const Evaluation = ({ resourceType, resourceId }: EvaluationResourceProps) => {
  if (resourceType === 'apps' || resourceType === 'snippets') {
    return (
      <EvaluationTargetWorkflowGuard
        key={`${resourceType}:${resourceId}`}
        resourceType={resourceType}
        resourceId={resourceId}
      >
        <EvaluationNodeNameNotice resourceType={resourceType} resourceId={resourceId}>
          <EvaluationContent resourceType={resourceType} resourceId={resourceId} />
        </EvaluationNodeNameNotice>
      </EvaluationTargetWorkflowGuard>
    )
  }

  return <EvaluationContent resourceType={resourceType} resourceId={resourceId} />
}

export default Evaluation
