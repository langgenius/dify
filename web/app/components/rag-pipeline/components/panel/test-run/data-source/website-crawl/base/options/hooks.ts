import type { BaseConfiguration } from '@/app/components/base/form/form-scenarios/base/types'
import { BaseFieldType } from '@/app/components/base/form/form-scenarios/base/types'
import { type RAGPipelineVariables, VAR_TYPE_MAP } from '@/models/pipeline'
import { useMemo } from 'react'

export const useInitialData = (variables: RAGPipelineVariables) => {
  const initialData = useMemo(() => {
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
  }, [variables])

  return initialData
}

export const useConfigurations = (variables: RAGPipelineVariables) => {
  const configurations = useMemo(() => {
    const configurations: BaseConfiguration[] = []
    variables.forEach((item) => {
      configurations.push({
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
      })
    })
    return configurations
  }, [variables])

  return configurations
}
