import { useMemo } from 'react'
import type { BaseConfiguration } from '@/app/components/base/form/form-scenarios/base/types'
import { BaseFieldType } from '@/app/components/base/form/form-scenarios/base/types'
import { useStore } from '@/app/components/workflow/store'
import { useDraftPipelineProcessingParams } from '@/service/use-pipeline'
import { VAR_TYPE_MAP } from '@/models/pipeline'

export const useConfigurations = (datasourceNodeId: string) => {
  const pipelineId = useStore(state => state.pipelineId)
  const { data: paramsConfig, isFetching: isFetchingParams } = useDraftPipelineProcessingParams({
    pipeline_id: pipelineId!,
    node_id: datasourceNodeId,
  })

  const initialData = useMemo(() => {
    const variables = paramsConfig?.variables || []
    return variables.reduce((acc, item) => {
      const type = VAR_TYPE_MAP[item.type]
      if ([BaseFieldType.textInput, BaseFieldType.paragraph, BaseFieldType.select].includes(type))
        acc[item.variable] = item.default_value ?? ''
      if (type === BaseFieldType.numberInput)
        acc[item.variable] = item.default_value ?? 0
      if (type === BaseFieldType.checkbox)
        acc[item.variable] = true
      if ([BaseFieldType.file, BaseFieldType.fileList].includes(type))
        acc[item.variable] = []
      return acc
    }, {} as Record<string, any>)
  }, [paramsConfig])

  const configurations = useMemo(() => {
    const variables = paramsConfig?.variables || []
    const configs: BaseConfiguration[] = variables.map(item => ({
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
