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
  const strategyProvider = useStrategyProviderDetail(
    inputs.agent_strategy_provider_name || '',
  )
  const currentStrategy = strategyProvider.data?.declaration.strategies.find(
    str => str.identity.name === inputs.agent_strategy_name,
  )
  const currentStrategyStatus = useMemo(() => {
    if (strategyProvider.isLoading) return 'loading'
    if (strategyProvider.isError) return 'plugin-not-found'
    if (!currentStrategy) return 'strategy-not-found'
    return 'success'
  }, [currentStrategy, strategyProvider])
  const formData = useMemo(() => {
    return Object.fromEntries(
      Object.entries(inputs.agent_parameters || {}).map(([key, value]) => {
        return [key, value.value]
      }),
    )
  }, [inputs.agent_parameters])
  const onFormChange = (value: Record<string, any>) => {
    const res: ToolVarInputs = {}
    Object.entries(value).forEach(([key, val]) => {
      res[key] = {
        type: VarType.constant,
        value: val,
      }
    })
    setInputs({
      ...inputs,
      agent_parameters: res,
    })
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
    currentStrategyStatus,
    strategyProvider: strategyProvider.data,
  }
}

export default useConfig
