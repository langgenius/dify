import { useTranslation } from 'react-i18next'
import { AddDocumentsStep } from './types'
import type { DataSourceOption, Datasource } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import { useMemo } from 'react'
import { BlockEnum, type Node } from '@/app/components/workflow/types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { DatasourceType } from '@/models/pipeline'

export const useAddDocumentsSteps = () => {
  const { t } = useTranslation()
  const steps = [
    {
      label: t('datasetPipeline.addDocuments.steps.chooseDatasource'),
      value: AddDocumentsStep.dataSource,
    },
    {
      label: t('datasetPipeline.addDocuments.steps.processDocuments'),
      value: AddDocumentsStep.processDocuments,
    },
    {
      label: t('datasetPipeline.addDocuments.steps.processingDocuments'),
      value: AddDocumentsStep.processingDocuments,
    },
  ]
  return steps
}

export const useDatasourceOptions = (pipelineNodes: Node<DataSourceNodeType>[]) => {
  const datasourceNodes = pipelineNodes.filter(node => node.data.type === BlockEnum.DataSource)
  const datasources: Datasource[] = useMemo(() => {
    return datasourceNodes.map((node) => {
      return {
        nodeId: node.id,
        type: node.data.provider_type as DatasourceType,
        variables: node.data.variables || [],
        description: node.data.desc || '',
        docTitle: '', // todo: Add docTitle and docLink if needed, or remove these properties if not used
        docLink: '',
        fileExtensions: node.data.fileExtensions || [],
      }
    })
  }, [datasourceNodes])

  const options = useMemo(() => {
    const options: DataSourceOption[] = []
    datasourceNodes.forEach((node) => {
      const label = node.data.title
      options.push({
        label,
        value: node.id,
        data: node.data,
      })
    })
    return options
  }, [datasourceNodes])

  return { datasources, options }
}
