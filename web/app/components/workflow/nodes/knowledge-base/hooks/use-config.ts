import {
  useCallback,
  useRef,
} from 'react'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import type { KnowledgeBaseNodeType } from '../types'

export const useConfig = (id: string, payload: KnowledgeBaseNodeType) => {
  const {
    inputs,
    setInputs,
  } = useNodeCrud(id, payload)
  const ref = useRef(inputs)

  const handleInputsChange = useCallback((newInputs: KnowledgeBaseNodeType) => {
    setInputs(newInputs)
    ref.current = newInputs
  }, [setInputs, ref])
}
