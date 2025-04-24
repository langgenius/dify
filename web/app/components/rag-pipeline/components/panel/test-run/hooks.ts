import { useTranslation } from 'react-i18next'
import type { DataSourceOption } from './types'
import { TestRunStep } from './types'
import { DataSourceType } from '@/models/datasets'
import { DataSourceProvider } from '@/models/common'

export const useTestRunSteps = () => {
  // TODO: i18n
  const { t } = useTranslation()
  const steps = [
    {
      label: 'DATA SOURCE',
      value: TestRunStep.dataSource,
    },
    {
      label: 'DOCUMENT PROCESSING',
      value: TestRunStep.documentProcessing,
    },
  ]
  return steps
}

export const useDataSourceOptions = (dataSources: string[]) => {
  // TODO: i18n
  const { t } = useTranslation()
  const options: DataSourceOption[] = []
  dataSources.forEach((source) => {
    if (source === DataSourceType.FILE) {
      options.push({
        label: 'Local Files',
        value: DataSourceType.FILE,
      })
    }
    if (source === DataSourceType.NOTION) {
      options.push({
        label: 'Notion',
        value: DataSourceType.NOTION,
      })
    }
    if (source === DataSourceProvider.fireCrawl) {
      options.push({
        label: 'Firecrawl',
        value: DataSourceProvider.fireCrawl,
      })
    }
    if (source === DataSourceProvider.jinaReader) {
      options.push({
        label: 'Jina Reader',
        value: DataSourceProvider.jinaReader,
      })
    }
    if (source === DataSourceProvider.waterCrawl) {
      options.push({
        label: 'Water Crawl',
        value: DataSourceProvider.waterCrawl,
      })
    }
  })
  return options
}
