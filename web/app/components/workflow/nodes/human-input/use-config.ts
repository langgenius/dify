import { produce } from 'immer'
import type { DeliveryMethod, HumanInputNodeType, UserAction } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'
import useFormContent from './use-form-content'
const useConfig = (id: string, payload: HumanInputNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { inputs, setInputs } = useNodeCrud<HumanInputNodeType>(id, payload)
  const formContentHook = useFormContent(id, payload)

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
  }

  const handleUserActionDelete = (actionId: string) => {
    const newActions = inputs.user_actions.filter(action => action.id !== actionId)
    setInputs({
      ...inputs,
      user_actions: newActions,
    })
  }

  const handleTimeoutChange = ({ timeout, unit }: { timeout: number; unit: 'hour' | 'day' }) => {
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
    ...formContentHook,
  }
}

export default useConfig
