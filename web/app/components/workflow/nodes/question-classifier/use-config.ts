import { useCallback } from 'react'
import produce from 'immer'
import type { Memory, ValueSelector } from '../../types'
import type { QuestionClassifierNodeType } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'

const useConfig = (id: string, payload: QuestionClassifierNodeType) => {
  const { inputs, setInputs } = useNodeCrud<QuestionClassifierNodeType>(id, payload)

  // model
  const handleModelChanged = useCallback((model: { provider: string; modelId: string; mode?: string }) => {
    const newInputs = produce(inputs, (draft) => {
      draft.model.provider = model.provider
      draft.model.name = model.modelId
      draft.model.mode = model.mode!
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleCompletionParamsChange = useCallback((newParams: Record<string, any>) => {
    const newInputs = produce(inputs, (draft) => {
      draft.model.completion_params = newParams
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleQueryVarChange = useCallback((newVar: ValueSelector) => {
    const newInputs = produce(inputs, (draft) => {
      draft.query_variable_selector = newVar
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleClassesChange = useCallback((newClasses: any) => {
    const newInputs = produce(inputs, (draft) => {
      draft.classes = newClasses
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleInstructionChange = useCallback((instruction: string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.instruction = instruction
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleMemoryChange = useCallback((memory: Memory) => {
    const newInputs = produce(inputs, (draft) => {
      draft.memory = memory
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  return {
    inputs,
    handleModelChanged,
    handleCompletionParamsChange,
    handleQueryVarChange,
    handleTopicsChange: handleClassesChange,
    handleInstructionChange,
    handleMemoryChange,
  }
}

export default useConfig
