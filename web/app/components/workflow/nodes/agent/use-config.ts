import { useStrategyProviderDetail } from '@/service/use-strategy'
import useNodeCrud from '../_base/hooks/use-node-crud'
import useVarList from '../_base/hooks/use-var-list'
import type { AgentNodeType } from './types'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'
import { useMemo } from 'react'
import { type ToolVarInputs, VarType } from '../tool/types'

const useConfig = (id: string, payload: AgentNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { inputs, setInputs } = useNodeCrud<AgentNodeType>(id, payload)
  // variables
  const { handleVarListChange, handleAddVariable } = useVarList<AgentNodeType>({
    inputs,
    setInputs,
  })
  const strategies = useStrategyProviderDetail(
    inputs.agent_strategy_provider_name || '',
  )
  const currentStrategy = strategies.data?.declaration.strategies.find(
    str => str.identity.name === inputs.agent_strategy_name,
  )
  const formData = useMemo(() => {
    return Object.fromEntries(
      Object.entries(inputs.agent_parameters || {}).map(([key, value]) => {
        return [key, value.value]
      }),
    )
  }, [inputs.agent_parameters])
  const onFormChange = (value: Record<string, any>) => {
    const res: ToolVarInputs = {}
    const params = currentStrategy!.parameters
    Object.entries(value).forEach(([key, val]) => {
      const param = params.find(p => p.name === key)
      const isMixed = param?.type === 'string'
      res[key] = {
        type: isMixed ? VarType.mixed : VarType.constant,
        value: val,
      }
    })
    setInputs({
      ...inputs,
      agent_parameters: res,
    })
    console.log(res)
  }
  return {
    readOnly,
    inputs,
    setInputs,
    handleVarListChange,
    handleAddVariable,
    currentStrategy,
    formData,
    onFormChange,
  }
}

export default useConfig
