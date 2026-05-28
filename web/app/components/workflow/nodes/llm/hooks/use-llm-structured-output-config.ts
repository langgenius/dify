import type { MutableRefObject } from 'react'
import type { LLMNodeType, StructuredOutput } from '../types'
import { produce } from 'immer'
import {
  useCallback,
  useState,
} from 'react'
import {
  ModelFeatureEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'

type Params = {
  id: string
  model: LLMNodeType['model']
  inputRef: MutableRefObject<LLMNodeType>
  setInputs: (inputs: LLMNodeType) => void
  deleteNodeInspectorVars: (nodeId: string) => void
}

const useLLMStructuredOutputConfig = ({
  id,
  model,
  inputRef,
  setInputs,
  deleteNodeInspectorVars,
}: Params) => {
  const { data: modelList } = useModelList(ModelTypeEnum.textGeneration)
  const isModelSupportStructuredOutput = modelList
    ?.find(providerItem => providerItem.provider === model?.provider)
    ?.models
    .find(modelItem => modelItem.model === model?.name)
    ?.features
    ?.includes(ModelFeatureEnum.StructuredOutput)

  const [structuredOutputCollapsed, setStructuredOutputCollapsed] = useState(true)

  const handleStructureOutputEnableChange = useCallback((enabled: boolean) => {
    const nextInputs = produce(inputRef.current, (draft) => {
      draft.structured_output_enabled = enabled
    })
    setInputs(nextInputs)
    if (enabled)
      setStructuredOutputCollapsed(false)
    deleteNodeInspectorVars(id)
  }, [deleteNodeInspectorVars, id, inputRef, setInputs])

  const handleStructureOutputChange = useCallback((newOutput: StructuredOutput) => {
    const nextInputs = produce(inputRef.current, (draft) => {
      draft.structured_output = newOutput
    })
    setInputs(nextInputs)
    deleteNodeInspectorVars(id)
  }, [deleteNodeInspectorVars, id, inputRef, setInputs])

  const handleReasoningFormatChange = useCallback((reasoningFormat: 'tagged' | 'separated') => {
    const nextInputs = produce(inputRef.current, (draft) => {
      draft.reasoning_format = reasoningFormat
    })
    setInputs(nextInputs)
  }, [inputRef, setInputs])

  return {
    isModelSupportStructuredOutput,
    structuredOutputCollapsed,
    setStructuredOutputCollapsed,
    handleStructureOutputEnableChange,
    handleStructureOutputChange,
    handleReasoningFormatChange,
  }
}

export default useLLMStructuredOutputConfig
