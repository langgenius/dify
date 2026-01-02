import type { HumanInputNodeType } from './types'
import { useCallback } from 'react'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'

const useConfig = (id: string, payload: HumanInputNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { inputs, setInputs } = useNodeCrud<HumanInputNodeType>(id, payload)

  const handlePauseReasonChange = useCallback((value: string) => {
    const newInputs = {
      ...inputs,
      pause_reason: value,
    }
    setInputs(newInputs)
  }, [inputs, setInputs])

  return {
    readOnly,
    inputs,
    handlePauseReasonChange,
  }
}

export default useConfig
