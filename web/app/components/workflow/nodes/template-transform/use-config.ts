import { useCallback } from 'react'
import produce from 'immer'
import useVarList from '../_base/hooks/use-var-list'
import type { TemplateTransformNodeType } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'

const useConfig = (id: string, payload: TemplateTransformNodeType) => {
  const { inputs, setInputs } = useNodeCrud<TemplateTransformNodeType>(id, payload)
  const { handleVarListChange, handleAddVariable } = useVarList<TemplateTransformNodeType>({
    inputs,
    setInputs,
  })

  const handleCodeChange = useCallback((template: string) => {
    const newInputs = produce(inputs, (draft: any) => {
      draft.template = template
    })
    setInputs(newInputs)
  }, [setInputs])

  return {
    inputs,
    handleVarListChange,
    handleAddVariable,
    handleCodeChange,
  }
}

export default useConfig
