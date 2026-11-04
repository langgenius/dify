import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { selectPipelineStepParameters } from '@/app/components/rag-pipeline/utils/query-select'
import { knowledgePipelineIdentityAtom } from '@/app/components/workflow/editor-resource/state'
import { consoleQuery } from '@/service/console'
import Form from './form'

type ProcessDocumentsProps = {
  dataSourceNodeId: string
}

const ProcessDocuments = ({ dataSourceNodeId }: ProcessDocumentsProps) => {
  const { t } = useTranslation(['datasetPipeline'])
  const pipelineId = useAtomValue(knowledgePipelineIdentityAtom).pipelineId
  const { data: paramsConfig } = useQuery(
    consoleQuery.rag.pipelines.byPipelineId.workflows.draft.processing.parameters.get.queryOptions({
      input: { params: { pipeline_id: pipelineId! }, query: { node_id: dataSourceNodeId } },
      enabled: !!pipelineId && !!dataSourceNodeId,
      select: selectPipelineStepParameters,
    }),
  )

  return (
    <div className="flex flex-col">
      <div className="px-4 pt-2 system-sm-semibold-uppercase text-text-secondary">
        {t(($) => $['inputFieldPanel.preview.stepTwoTitle'], { ns: 'datasetPipeline' })}
      </div>
      <Form variables={paramsConfig?.variables || []} />
    </div>
  )
}

export default React.memo(ProcessDocuments)
