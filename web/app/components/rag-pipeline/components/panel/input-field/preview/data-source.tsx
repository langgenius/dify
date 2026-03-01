import type { Datasource } from '../../test-run/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'
import { useDraftPipelinePreProcessingParams } from '@/service/use-pipeline'
import DataSourceOptions from '../../test-run/preparation/data-source-options'
import Form from './form'

type DatasourceProps = {
  onSelect: (dataSource: Datasource) => void
  dataSourceNodeId: string
}

const DataSource = ({
  onSelect: setDatasource,
  dataSourceNodeId,
}: DatasourceProps) => {
  const { t } = useTranslation()
  const pipelineId = useStore(state => state.pipelineId)
  const { data: paramsConfig } = useDraftPipelinePreProcessingParams({
    pipeline_id: pipelineId!,
    node_id: dataSourceNodeId,
  }, !!pipelineId && !!dataSourceNodeId)

  return (
    <div className="flex flex-col">
      <div className="system-sm-semibold-uppercase px-4 pt-2 text-text-secondary">
        {t('inputFieldPanel.preview.stepOneTitle', { ns: 'datasetPipeline' })}
      </div>
      <div className="px-4 py-2">
        <DataSourceOptions
          onSelect={setDatasource}
          dataSourceNodeId={dataSourceNodeId}
        />
      </div>
      <Form variables={paramsConfig?.variables || []} />
    </div>
  )
}

export default React.memo(DataSource)
