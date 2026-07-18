import type { HumanInputSharedNodeType, UserAction } from './types'
import { produce } from 'immer'
import { useState } from 'react'
import { useUpdateNodeInternals } from 'reactflow'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import { useEdgesInteractions } from '@/app/components/workflow/hooks/use-edges-interactions'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import useHumanInputFormContent from './use-form-content'

const useHumanInputSharedConfig = <T extends HumanInputSharedNodeType>(id: string, payload: T) => {
  const updateNodeInternals = useUpdateNodeInternals()
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { inputs, setInputs } = useNodeCrud<T>(id, payload)
  const formContentHook = useHumanInputFormContent(id, payload)
  const { handleEdgeDeleteByDeleteBranch, handleEdgeSourceHandleChange } = useEdgesInteractions()
  const [structuredOutputCollapsed, setStructuredOutputCollapsed] = useState(true)

  const handleUserActionAdd = (newAction: UserAction) => {
    setInputs({ ...inputs, user_actions: [...inputs.user_actions, newAction] })
  }

  const handleUserActionChange = (index: number, updatedAction: UserAction) => {
    const newActions = produce(inputs.user_actions, (draft) => {
      if (draft[index]) draft[index] = updatedAction
    })
    setInputs({ ...inputs, user_actions: newActions })

    const oldAction = inputs.user_actions[index]
    if (oldAction && oldAction.id !== updatedAction.id) {
      handleEdgeSourceHandleChange(id, oldAction.id, updatedAction.id)
      updateNodeInternals(id)
    }
  }

  const handleUserActionDelete = (actionId: string) => {
    setInputs({
      ...inputs,
      user_actions: inputs.user_actions.filter((action) => action.id !== actionId),
    })
    handleEdgeDeleteByDeleteBranch(id, actionId)
  }

  const handleTimeoutChange = ({ timeout, unit }: { timeout: number; unit: 'hour' | 'day' }) => {
    setInputs({ ...inputs, timeout, timeout_unit: unit })
  }

  return {
    readOnly,
    inputs,
    setInputs,
    handleUserActionAdd,
    handleUserActionChange,
    handleUserActionDelete,
    handleTimeoutChange,
    structuredOutputCollapsed,
    setStructuredOutputCollapsed,
    ...formContentHook,
  }
}

export default useHumanInputSharedConfig
