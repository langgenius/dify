import type { Datasource } from '../../test-run/types'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { selectPipelineStepParameters } from '@/app/components/rag-pipeline/utils/query-select'
import { useStore } from '@/app/components/workflow/store'
import { consoleQuery } from '@/service/console'
import DataSourceOptions from '../../test-run/preparation/data-source-options'
import Form from './form'

type DatasourceProps = {
  onSelect: (dataSource: Datasource) => void
  dataSourceNodeId: string
}

const DataSource = ({ onSelect: setDatasource, dataSourceNodeId }: DatasourceProps) => {
  const { t } = useTranslation(['datasetPipeline'])
  const pipelineId = useStore((state) => state.pipelineId)
  const { data: paramsConfig } = useQuery(
    consoleQuery.rag.pipelines.byPipelineId.workflows.draft.preProcessing.parameters.get.queryOptions(
      {
        input: { params: { pipeline_id: pipelineId! }, query: { node_id: dataSourceNodeId } },
        enabled: !!pipelineId && !!dataSourceNodeId,
        select: selectPipelineStepParameters,
      },
    ),
  )

  return (
    <div className="flex flex-col">
      <div className="px-4 pt-2 system-sm-semibold-uppercase text-text-secondary">
        {t(($) => $['inputFieldPanel.preview.stepOneTitle'], { ns: 'datasetPipeline' })}
      </div>
      <div className="px-4 py-2">
        <DataSourceOptions onSelect={setDatasource} dataSourceNodeId={dataSourceNodeId} />
      </div>
      <Form variables={paramsConfig?.variables || []} />
    </div>
  )
}

export default React.memo(DataSource)
