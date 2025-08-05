import produce from 'immer'
import type { DeliveryMethod, HumanInputNodeType, Timeout, UserAction } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'
const useConfig = (id: string, payload: HumanInputNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { inputs, setInputs } = useNodeCrud<HumanInputNodeType>(id, payload)

  // 1 check email address valid
  // 2 use immer to handle delivery method configuration

  const handleDeliveryMethodChange = (methods: DeliveryMethod[]) => {
    setInputs({
      ...inputs,
      deliveryMethod: methods,
    })
  }

  const handleUserActionAdd = (newAction: UserAction) => {
    setInputs({
      ...inputs,
      userActions: [...inputs.userActions, newAction],
    })
  }

  const handleUserActionChange = (updatedAction: UserAction) => {
    const newActions = produce(inputs.userActions, (draft) => {
      const index = draft.findIndex(a => a.id === updatedAction.id)
      if (index !== -1)
        draft[index] = updatedAction
    })
    setInputs({
      ...inputs,
      userActions: newActions,
    })
  }

  const handleUserActionDelete = (actionId: string) => {
    const newActions = inputs.userActions.filter(action => action.id !== actionId)
    setInputs({
      ...inputs,
      userActions: newActions,
    })
  }

  const handleTimeoutChange = (timeout: Timeout) => {
    setInputs({
      ...inputs,
      timeout,
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
  }
}

export default useConfig
