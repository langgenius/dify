import { useTranslation } from 'react-i18next'
import { AddDocumentsStep } from './types'
import type { DataSourceOption, Datasource } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import { useMemo } from 'react'
import { BlockEnum, type Node } from '@/app/components/workflow/types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { DataSourceType } from '@/models/datasets'
import { DataSourceProvider } from '@/models/common'

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
  const { t } = useTranslation()
  const datasources: Datasource[] = useMemo(() => {
    const datasourceNodes = pipelineNodes.filter(node => node.data.type === BlockEnum.DataSource)
    return datasourceNodes.map((node) => {
      let type: DataSourceType | DataSourceProvider = DataSourceType.FILE
      switch (node.data.tool_name) {
        case 'file_upload':
          type = DataSourceType.FILE
          break
        case 'search_notion':
          type = DataSourceType.NOTION
          break
        case 'firecrawl':
          type = DataSourceProvider.fireCrawl
          break
        case 'jina_reader':
          type = DataSourceProvider.jinaReader
          break
        case 'water_crawl':
          type = DataSourceProvider.waterCrawl
          break
      }
      return {
        nodeId: node.id,
        type,
        variables: node.data.variables,
      }
    })
  }, [pipelineNodes])

  const options = useMemo(() => {
    const options: DataSourceOption[] = []
    datasources.forEach((source) => {
      if (source.type === DataSourceType.FILE) {
        options.push({
          label: t('datasetPipeline.testRun.dataSource.localFiles'),
          value: source.nodeId,
          type: DataSourceType.FILE,
        })
      }
      if (source.type === DataSourceType.NOTION) {
        options.push({
          label: 'Notion',
          value: source.nodeId,
          type: DataSourceType.NOTION,
        })
      }
      if (source.type === DataSourceProvider.fireCrawl) {
        options.push({
          label: 'Firecrawl',
          value: source.nodeId,
          type: DataSourceProvider.fireCrawl,
        })
      }
      if (source.type === DataSourceProvider.jinaReader) {
        options.push({
          label: 'Jina Reader',
          value: source.nodeId,
          type: DataSourceProvider.jinaReader,
        })
      }
      if (source.type === DataSourceProvider.waterCrawl) {
        options.push({
          label: 'Water Crawl',
          value: source.nodeId,
          type: DataSourceProvider.waterCrawl,
        })
      }
    })
    return options
  }, [datasources, t])

  return { datasources, options }
}
