import { useTranslation } from 'react-i18next'
import type { DataSourceOption, Datasource } from './types'
import { TestRunStep } from './types'
import { useNodes } from 'reactflow'
import { BlockEnum } from '@/app/components/workflow/types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { useCallback, useMemo, useState } from 'react'
import type { DatasourceType } from '@/models/pipeline'
import type { CrawlResultItem, FileItem } from '@/models/datasets'
import produce from 'immer'
import type { NotionPage } from '@/models/common'

export const useTestRunSteps = () => {
  const { t } = useTranslation()
  const [currentStep, setCurrentStep] = useState(1)

  const handleNextStep = useCallback(() => {
    setCurrentStep(preStep => preStep + 1)
  }, [])

  const handleBackStep = useCallback(() => {
    setCurrentStep(preStep => preStep - 1)
  }, [])

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

  return {
    steps,
    currentStep,
    handleNextStep,
    handleBackStep,
  }
}

export const useDatasourceOptions = () => {
  const nodes = useNodes<DataSourceNodeType>()
  const datasourceNodes = nodes.filter(node => node.data.type === BlockEnum.DataSource)
  const datasources: Datasource[] = useMemo(() => {
    return datasourceNodes.map((node) => {
      return {
        nodeId: node.id,
        type: node.data.provider_type as DatasourceType,
        description: node.data.datasource_label,
        docTitle: 'How to use?',
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

export const useLocalFile = () => {
  const [fileList, setFileList] = useState<FileItem[]>([])

  const allFileLoaded = useMemo(() => (fileList.length > 0 && fileList.every(file => file.file.id)), [fileList])

  const updateFile = (fileItem: FileItem, progress: number, list: FileItem[]) => {
    const newList = produce(list, (draft) => {
      const targetIndex = draft.findIndex(file => file.fileID === fileItem.fileID)
      draft[targetIndex] = {
        ...draft[targetIndex],
        progress,
      }
    })
    setFileList(newList)
  }

  const updateFileList = (preparedFiles: FileItem[]) => {
    setFileList(preparedFiles)
  }

  return {
    fileList,
    allFileLoaded,
    updateFile,
    updateFileList,
  }
}

export const useNotionPages = () => {
  const [notionPages, setNotionPages] = useState<NotionPage[]>([])

  const updateNotionPages = (value: NotionPage[]) => {
    setNotionPages(value)
  }

  return {
    notionPages,
    updateNotionPages,
  }
}

export const useWebsiteCrawl = () => {
  const [websitePages, setWebsitePages] = useState<CrawlResultItem[]>([])
  const [websiteCrawlJobId, setWebsiteCrawlJobId] = useState('')

  return {
    websitePages,
    websiteCrawlJobId,
    setWebsitePages,
    setWebsiteCrawlJobId,
  }
}
