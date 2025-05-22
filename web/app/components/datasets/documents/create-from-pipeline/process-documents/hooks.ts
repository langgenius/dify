import { useMemo } from 'react'
import { BaseFieldType } from '@/app/components/base/form/form-scenarios/base/types'
import { usePublishedPipelineProcessingParams } from '@/service/use-pipeline'
import { PipelineInputVarType } from '@/models/pipeline'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'

type PartialInputVarType = PipelineInputVarType.textInput | PipelineInputVarType.number | PipelineInputVarType.select | PipelineInputVarType.checkbox

const VAR_TYPE_MAP: Record<PartialInputVarType, BaseFieldType> = {
  [PipelineInputVarType.textInput]: BaseFieldType.textInput,
  [PipelineInputVarType.number]: BaseFieldType.numberInput,
  [PipelineInputVarType.select]: BaseFieldType.select,
  [PipelineInputVarType.checkbox]: BaseFieldType.checkbox,
}

export const useConfigurations = (datasourceNodeId: string) => {
  const pipelineId = useDatasetDetailContextWithSelector(state => state.dataset?.pipeline_id)
  const { data: paramsConfig } = usePublishedPipelineProcessingParams({
    pipeline_id: pipelineId!,
    node_id: datasourceNodeId,
  })

  const initialData = useMemo(() => {
    const variables = paramsConfig?.variables || []
    return variables.reduce((acc, item) => {
      const type = VAR_TYPE_MAP[item.type as PartialInputVarType]
      if (type === BaseFieldType.textInput)
        acc[item.variable] = ''
      if (type === BaseFieldType.numberInput)
        acc[item.variable] = 0
      if (type === BaseFieldType.select)
        acc[item.variable] = item.options?.[0] || ''
      if (type === BaseFieldType.checkbox)
        acc[item.variable] = true
      return acc
    }, {} as Record<string, any>)
  }, [paramsConfig])

  const configurations = useMemo(() => {
    const variables = paramsConfig?.variables || []
    const configs = variables.map(item => ({
      type: VAR_TYPE_MAP[item.type as PartialInputVarType],
      variable: item.variable,
      label: item.label,
      required: item.required,
      maxLength: item.max_length,
      options: item.options?.map(option => ({
        label: option,
        value: option,
      })),
      showConditions: [],
      default: item.default_value,
    }))
    return configs
  }, [paramsConfig])

  return {
    initialData,
    configurations,
  }
}
