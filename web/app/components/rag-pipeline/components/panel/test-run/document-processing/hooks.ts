import { useMemo } from 'react'
import { BaseFieldType } from '@/app/components/base/form/form-scenarios/base/types'
import { useStore } from '@/app/components/workflow/store'
import { InputVarType } from '@/app/components/workflow/types'
import { usePipelineProcessingParams } from '@/service/use-pipeline'

type PartialInputVarType = InputVarType.textInput | InputVarType.number | InputVarType.select | InputVarType.checkbox

const VAR_TYPE_MAP: Record<PartialInputVarType, BaseFieldType> = {
  [InputVarType.textInput]: BaseFieldType.textInput,
  [InputVarType.number]: BaseFieldType.numberInput,
  [InputVarType.select]: BaseFieldType.select,
  [InputVarType.checkbox]: BaseFieldType.checkbox,
}

export const useConfigurations = () => {
  const pipelineId = useStore(state => state.pipelineId)
  const { data: paramsConfig } = usePipelineProcessingParams(pipelineId!)

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
      default: item.default,
    }))
    return configs
  }, [paramsConfig])

  return {
    initialData,
    configurations,
  }
}
