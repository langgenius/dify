import type { BaseConfiguration, BaseFieldType } from '@/app/components/base/form/form-scenarios/base/types'
import { PipelineInputVarType, type RAGPipelineVariables } from '@/models/pipeline'
import { useMemo } from 'react'

export const useInitialData = (variables: RAGPipelineVariables) => {
  const initialData = useMemo(() => {
    const initialData: Record<string, any> = {}
    variables.forEach((item) => {
      if ([PipelineInputVarType.textInput, PipelineInputVarType.paragraph, PipelineInputVarType.select].includes(item.type))
        initialData[item.variable] = item.default_value || ''
      if (item.type === PipelineInputVarType.number)
        initialData[item.variable] = item.default_value || 0
      if ([PipelineInputVarType.singleFile, PipelineInputVarType.multiFiles].includes(item.type))
        initialData[item.variable] = []
      if (item.type === PipelineInputVarType.checkbox)
        initialData[item.variable] = item.default_value || true
    })
    return initialData
  }, [variables])

  return initialData
}

export const useConfigurations = (variables: RAGPipelineVariables) => {
  const configurations = useMemo(() => {
    const configurations: BaseConfiguration[] = []
    variables.forEach((item) => {
      configurations.push({
        type: item.type as unknown as BaseFieldType,
        variable: item.variable,
        label: item.label,
        required: item.required,
        placeholder: item.placeholder,
        tooltip: item.tooltips,
        options: item.options?.map(option => ({
          label: option,
          value: option,
        })),
        maxLength: item.max_length,
        showConditions: [],
        allowedFileUploadMethods: item.allowed_file_upload_methods,
        allowedFileTypes: item.allowed_file_types,
        allowedFileExtensions: item.allowed_file_extensions,
      })
    })
    return configurations
  }, [variables])

  return configurations
}
