import { useMemo } from 'react'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { usePublishedPipelineProcessingParams } from '@/service/use-pipeline'
import { VAR_TYPE_MAP } from '@/models/pipeline'
import { BaseFieldType } from '@/app/components/base/form/form-scenarios/base/types'

export const useConfigurations = (lastRunInputData: Record<string, any>, datasourceNodeId: string) => {
  const pipelineId = useDatasetDetailContextWithSelector(state => state.dataset?.pipeline_id)
  const { data: paramsConfig, isFetching: isFetchingParams } = usePublishedPipelineProcessingParams({
    pipeline_id: pipelineId!,
    node_id: datasourceNodeId,
  })

  const initialData = useMemo(() => {
    const variables = paramsConfig?.variables || []
    return variables.reduce((acc, item) => {
      const type = VAR_TYPE_MAP[item.type]
      const variableName = item.variable
      if ([BaseFieldType.textInput, BaseFieldType.paragraph, BaseFieldType.select].includes(type))
        acc[item.variable] = lastRunInputData[variableName] ?? ''
      if (type === BaseFieldType.numberInput)
        acc[item.variable] = lastRunInputData[variableName] ?? 0
      if (type === BaseFieldType.checkbox)
        acc[item.variable] = lastRunInputData[variableName]
      if ([BaseFieldType.file, BaseFieldType.fileList].includes(type))
        acc[item.variable] = lastRunInputData[variableName]
      return acc
    }, {} as Record<string, any>)
  }, [lastRunInputData, paramsConfig?.variables])

  const configurations = useMemo(() => {
    const variables = paramsConfig?.variables || []
    const configs = variables.map(item => ({
      type: VAR_TYPE_MAP[item.type],
      variable: item.variable,
      label: item.label,
      required: item.required,
      maxLength: item.max_length,
      options: item.options?.map(option => ({
        label: option,
        value: option,
      })),
      showConditions: [],
      placeholder: item.placeholder,
      tooltip: item.tooltips,
      unit: item.unit,
      allowedFileTypes: item.allowed_file_types,
      allowedFileExtensions: item.allowed_file_extensions,
      allowedFileUploadMethods: item.allowed_file_upload_methods,
    }))
    return configs
  }, [paramsConfig])

  return {
    isFetchingParams,
    initialData,
    configurations,
  }
}
