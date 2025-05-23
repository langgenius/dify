import { useTranslation } from 'react-i18next'
import type { DataSourceOption, Datasource } from './types'
import { TestRunStep } from './types'
import { DataSourceType } from '@/models/datasets'
import { DataSourceProvider } from '@/models/common'
import { useNodes } from 'reactflow'
import { BlockEnum } from '@/app/components/workflow/types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { useMemo } from 'react'

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
  const { t } = useTranslation()
  const nodes = useNodes<DataSourceNodeType>()
  const datasources: Datasource[] = useMemo(() => {
    const datasourceNodes = nodes.filter(node => node.data.type === BlockEnum.DataSource)
    return datasourceNodes.map((node) => {
      let type: DataSourceType | DataSourceProvider = DataSourceType.FILE
      // todo: distinguish datasource type via provider_type field
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
  }, [nodes])

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

export const useWebCrawlerHeaderInfo = () => {
  const { t } = useTranslation()
  const I18N_PREFIX = 'datasetCreation.stepOne.website'

  const headerInfoMap: Record<DataSourceProvider, {
    title: string
    docTitle: string
    docLink: string
  }> = {
    [DataSourceProvider.fireCrawl]: {
      title: t(`${I18N_PREFIX}.firecrawlTitle`),
      docTitle: t(`${I18N_PREFIX}.firecrawlDoc`),
      docLink: 'https://docs.firecrawl.dev/introduction',
    },
    [DataSourceProvider.jinaReader]: {
      title: t(`${I18N_PREFIX}.jinaReaderTitle`),
      docTitle: t(`${I18N_PREFIX}.jinaReaderDoc`),
      docLink: 'https://jina.ai/reader',
    },
    [DataSourceProvider.waterCrawl]: {
      title: t(`${I18N_PREFIX}.watercrawlTitle`),
      docTitle: t(`${I18N_PREFIX}.watercrawlDoc`),
      docLink: 'https://docs.watercrawl.dev/',
    },
  }
  return headerInfoMap
}
