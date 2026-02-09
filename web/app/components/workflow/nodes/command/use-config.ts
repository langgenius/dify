import type { CommandNodeType } from './types'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'

const useConfig = (id: string, payload: CommandNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { inputs, setInputs } = useNodeCrud<CommandNodeType>(id, payload)

  const handleWorkingDirectoryChange = useCallback((value: string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.working_directory = value
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleCommandChange = useCallback((value: string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.command = value
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  return {
    readOnly,
    inputs,
    handleWorkingDirectoryChange,
    handleCommandChange,
  }
}

export default useConfig
