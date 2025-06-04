import React from 'react'
import { useTranslation } from 'react-i18next'
import DataSourceOptions from '../../panel/test-run/data-source-options'
import Form from './form'
import type { Datasource } from '../../panel/test-run/types'

type DatasourceProps = {
  onSelect: (dataSource: Datasource) => void
  datasourceNodeId: string
}

const DataSource = ({
  onSelect: setDatasource,
  datasourceNodeId,
}: DatasourceProps) => {
  const { t } = useTranslation()

  return (
    <div className='flex flex-col'>
      <div className='system-sm-semibold-uppercase px-4 pt-2 text-text-secondary'>
        {t('datasetPipeline.inputFieldPanel.preview.stepOneTitle')}
      </div>
      <div className='px-4 py-2'>
        <DataSourceOptions
          onSelect={setDatasource}
          datasourceNodeId={datasourceNodeId}
        />
      </div>
      <Form variables={[]} />
    </div>
  )
}

export default React.memo(DataSource)
