import type { DeliveryMethod, HumanInputNodeType, UserAction } from '../types'
import { produce } from 'immer'
import { useState } from 'react'
import { useUpdateNodeInternals } from 'reactflow'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'
import { useEdgesInteractions } from '@/app/components/workflow/hooks/use-edges-interactions'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import useFormContent from './use-form-content'

const useConfig = (id: string, payload: HumanInputNodeType) => {
  const updateNodeInternals = useUpdateNodeInternals()
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { inputs, setInputs } = useNodeCrud<HumanInputNodeType>(id, payload)
  const formContentHook = useFormContent(id, payload)
  const { handleEdgeDeleteByDeleteBranch, handleEdgeSourceHandleChange } = useEdgesInteractions()
  const [structuredOutputCollapsed, setStructuredOutputCollapsed] = useState(true)

  const handleDeliveryMethodChange = (methods: DeliveryMethod[]) => {
    setInputs({
      ...inputs,
      delivery_methods: methods,
    })
  }

  const handleUserActionAdd = (newAction: UserAction) => {
    setInputs({
      ...inputs,
      user_actions: [...inputs.user_actions, newAction],
    })
  }

  const handleUserActionChange = (index: number, updatedAction: UserAction) => {
    const newActions = produce(inputs.user_actions, (draft) => {
      if (draft[index])
        draft[index] = updatedAction
    })
    setInputs({
      ...inputs,
      user_actions: newActions,
    })

    // Update edges to use the new handle
    const oldAction = inputs.user_actions[index]

    if (oldAction && oldAction.id !== updatedAction.id) {
      handleEdgeSourceHandleChange(id, oldAction.id, updatedAction.id)
      updateNodeInternals(id) // Update handles
    }
  }

  const handleUserActionDelete = (actionId: string) => {
    const newActions = inputs.user_actions.filter(action => action.id !== actionId)
    setInputs({
      ...inputs,
      user_actions: newActions,
    })
    // Delete edges connected to this action
    handleEdgeDeleteByDeleteBranch(id, actionId)
  }

  const handleTimeoutChange = ({ timeout, unit }: { timeout: number, unit: 'hour' | 'day' }) => {
    setInputs({
      ...inputs,
      timeout,
      timeout_unit: unit,
    })
  }

  return {
    readOnly,
    inputs,
    handleDeliveryMethodChange,
    handleUserActionAdd,
    handleUserActionChange,
    handleUserActionDelete,
    handleTimeoutChange,
    structuredOutputCollapsed,
    setStructuredOutputCollapsed,
    ...formContentHook,
  }
}

export default useConfig
