import { useTranslation } from 'react-i18next'
import type { DataSourceOption, Datasource } from './types'
import { TestRunStep } from './types'
import { useNodes } from 'reactflow'
import { BlockEnum } from '@/app/components/workflow/types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { useMemo } from 'react'
import type { DatasourceType } from '@/models/pipeline'

export const useTestRunSteps = () => {
  const { t } = useTranslation()
  const steps = [
    {
      label: t('datasetPipeline.testRun.steps.dataSource'),
      value: TestRunStep.dataSource,
    },
    {
      label: t('datasetPipeline.testRun.steps.documentProcessing'),
      value: TestRunStep.documentProcessing,
    },
  ]
  return steps
}

export const useDatasourceOptions = () => {
  const nodes = useNodes<DataSourceNodeType>()
  const datasourceNodes = nodes.filter(node => node.data.type === BlockEnum.DataSource)
  const datasources: Datasource[] = useMemo(() => {
    return datasourceNodes.map((node) => {
      return {
        nodeId: node.id,
        type: node.data.provider_type as DatasourceType,
        variables: node.data.variables || [],
        description: node.data.desc || '',
        docTitle: '', // todo: Add docTitle and docLink
        docLink: '',
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
