import type { DeepKeys } from '@tanstack/react-form'
import type { FormData } from '@/app/components/rag-pipeline/components/panel/input-field/editor/form/types'
import { useMemo } from 'react'
import { useConfigurations } from '@/app/components/rag-pipeline/components/panel/input-field/editor/form/hooks'
import { PipelineInputVarType } from '@/models/pipeline'

type UseSnippetInputFieldConfigurationsProps = {
  getFieldValue: (fieldName: DeepKeys<FormData>) => unknown
  setFieldValue: (fieldName: DeepKeys<FormData>, value: unknown) => void
  supportFile: boolean
}

export const useSnippetInputFieldConfigurations = (props: UseSnippetInputFieldConfigurationsProps) => {
  const configurations = useConfigurations(props)

  return useMemo(() => {
    return configurations.map((configuration) => {
      const isTextMaxLengthField = configuration.variable === 'maxLength'
        && configuration.showConditions?.some(condition => condition.value === PipelineInputVarType.textInput)

      if (!isTextMaxLengthField)
        return configuration

      return {
        ...configuration,
        required: false,
      }
    })
  }, [configurations])
}
