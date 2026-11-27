import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { selectPipelineStepParameters } from '@/app/components/rag-pipeline/utils/query-select'
import { knowledgePipelineIdentityAtom } from '@/app/components/workflow/editor-resource/state'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import Form from './form'

type ProcessDocumentsProps = {
  dataSourceNodeId: string
}

const ProcessDocuments = ({ dataSourceNodeId }: ProcessDocumentsProps) => {
  const { t } = useTranslation(['datasetPipeline', 'common', 'dataset'])
  const pipelineId = useAtomValue(knowledgePipelineIdentityAtom).pipelineId
  const paramsConfigQuery = useQuery(
    consoleQuery.rag.pipelines.byPipelineId.workflows.draft.processing.parameters.get.queryOptions({
      input:
        pipelineId && dataSourceNodeId
          ? { params: { pipeline_id: pipelineId }, query: { node_id: dataSourceNodeId } }
          : skipToken,
      select: selectPipelineStepParameters,
    }),
  )
  const paramsConfig = paramsConfigQuery.data
  // A failed load must not preview the step as if it had no input fields.
  const paramsConfigLoad = useOwnedQueryError(paramsConfigQuery)
  const loadErrorMessage = useRequestErrorMessage(
    paramsConfigLoad?.error,
    t(($) => $.loadError, { ns: 'dataset' }),
  )

  return (
    <div className="flex flex-col">
      <div className="px-4 pt-2 system-sm-semibold-uppercase text-text-secondary">
        {t(($) => $['inputFieldPanel.preview.stepTwoTitle'], { ns: 'datasetPipeline' })}
      </div>
      {paramsConfigLoad ? (
        <div className="px-4 py-2">
          <Alert type="error">
            <AlertTitle>{loadErrorMessage}</AlertTitle>
            <AlertActions>
              <Button
                size="small"
                loading={paramsConfigLoad.retrying}
                onClick={paramsConfigLoad.retry}
              >
                {t(($) => $['operation.retry'], { ns: 'common' })}
              </Button>
            </AlertActions>
          </Alert>
        </div>
      ) : (
        <Form variables={paramsConfig?.variables || []} />
      )}
    </div>
  )
}

export default React.memo(ProcessDocuments)
