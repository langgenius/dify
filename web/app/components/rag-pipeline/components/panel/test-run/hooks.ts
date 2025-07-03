import { useTranslation } from 'react-i18next'
import type { DataSourceOption } from './types'
import { TestRunStep } from './types'
import { useNodes } from 'reactflow'
import { BlockEnum } from '@/app/components/workflow/types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { useCallback, useMemo, useState } from 'react'
import type { OnlineDriveFile } from '@/models/pipeline'

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

  return options
}

export const useOnlineDrive = () => {
  const [prefix, setPrefix] = useState<string[]>([])
  const [keywords, setKeywords] = useState('')
  const [bucket, setBucket] = useState('')
  const [startAfter, setStartAfter] = useState('')
  const [selectedFileList, setSelectedFileList] = useState<string[]>([])
  const [fileList, setFileList] = useState<OnlineDriveFile[]>([])

  return {
    prefix,
    setPrefix,
    keywords,
    setKeywords,
    bucket,
    setBucket,
    startAfter,
    setStartAfter,
    selectedFileList,
    setSelectedFileList,
    fileList,
    setFileList,
  }
}
