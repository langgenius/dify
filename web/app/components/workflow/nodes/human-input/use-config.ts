import type { HumanInputNodeType, Timeout } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'
const useConfig = (id: string, payload: HumanInputNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { inputs, setInputs } = useNodeCrud<HumanInputNodeType>(id, payload)

  const handleTimeoutChange = (timeout: Timeout) => {
    setInputs({
      ...inputs,
      timeout,
    })
  }

  return {
    readOnly,
    inputs,
    handleTimeoutChange,
  }
}

export default useConfig
