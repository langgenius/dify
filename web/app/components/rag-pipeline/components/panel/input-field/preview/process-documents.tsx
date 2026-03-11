import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'
import { useDraftPipelineProcessingParams } from '@/service/use-pipeline'
import Form from './form'

type ProcessDocumentsProps = {
  dataSourceNodeId: string
}

const ProcessDocuments = ({
  dataSourceNodeId,
}: ProcessDocumentsProps) => {
  const { t } = useTranslation()
  const pipelineId = useStore(state => state.pipelineId)
  const { data: paramsConfig } = useDraftPipelineProcessingParams({
    pipeline_id: pipelineId!,
    node_id: dataSourceNodeId,
  }, !!pipelineId && !!dataSourceNodeId)

  return (
    <div className="flex flex-col">
      <div className="system-sm-semibold-uppercase px-4 pt-2 text-text-secondary">
        {t('inputFieldPanel.preview.stepTwoTitle', { ns: 'datasetPipeline' })}
      </div>
      <Form variables={paramsConfig?.variables || []} />
    </div>
  )
}

export default React.memo(ProcessDocuments)
