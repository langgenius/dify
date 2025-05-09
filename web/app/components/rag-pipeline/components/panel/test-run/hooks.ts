import { useTranslation } from 'react-i18next'
import type { DataSourceOption, Datasource } from './types'
import { TestRunStep } from './types'
import { DataSourceType } from '@/models/datasets'
import { DataSourceProvider } from '@/models/common'

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

export const useDataSourceOptions = (dataSources: Datasource[]) => {
  const { t } = useTranslation()
  const options: DataSourceOption[] = []
  dataSources.forEach((source) => {
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
}
