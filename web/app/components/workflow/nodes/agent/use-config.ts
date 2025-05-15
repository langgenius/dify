import { useStrategyProviderDetail } from '@/service/use-strategy'
import useNodeCrud from '../_base/hooks/use-node-crud'
import useVarList from '../_base/hooks/use-var-list'
import useOneStepRun from '../_base/hooks/use-one-step-run'
import type { AgentNodeType } from './types'
import {
  useIsChatMode,
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'
import { useCallback, useMemo } from 'react'
import { type ToolVarInputs, VarType } from '../tool/types'
import { useCheckInstalled, useFetchPluginsInMarketPlaceByIds } from '@/service/use-plugins'
import type { Memory, Var } from '../../types'
import { VarType as VarKindType } from '../../types'
import useAvailableVarList from '../_base/hooks/use-available-var-list'
import produce from 'immer'

export type StrategyStatus = {
  plugin: {
    source: 'external' | 'marketplace'
    installed: boolean
  }
  isExistInPlugin: boolean
}

export const useStrategyInfo = (
  strategyProviderName?: string,
  strategyName?: string,
) => {
  const strategyProvider = useStrategyProviderDetail(
    strategyProviderName || '',
    { retry: false },
  )
  const strategy = strategyProvider.data?.declaration.strategies.find(
    str => str.identity.name === strategyName,
  )
  const marketplace = useFetchPluginsInMarketPlaceByIds([strategyProviderName!], {
    retry: false,
  })
  const strategyStatus: StrategyStatus | undefined = useMemo(() => {
    if (strategyProvider.isLoading || marketplace.isLoading)
      return undefined
    const strategyExist = !!strategy
    const isPluginInstalled = !strategyProvider.isError
    const isInMarketplace = !!marketplace.data?.data.plugins.at(0)
    return {
      plugin: {
        source: isInMarketplace ? 'marketplace' : 'external',
        installed: isPluginInstalled,
      },
      isExistInPlugin: strategyExist,
    }
  }, [strategy, marketplace, strategyProvider.isError, strategyProvider.isLoading])
  const refetch = useCallback(() => {
    strategyProvider.refetch()
    marketplace.refetch()
  }, [marketplace, strategyProvider])
  return {
    strategyProvider,
    strategy,
    strategyStatus,
    refetch,
  }
}

const useConfig = (id: string, payload: AgentNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { inputs, setInputs } = useNodeCrud<AgentNodeType>(id, payload)
  // variables
  const { handleVarListChange, handleAddVariable } = useVarList<AgentNodeType>({
    inputs,
    setInputs,
  })
  const {
    strategyStatus: currentStrategyStatus,
    strategy: currentStrategy,
    strategyProvider,
  } = useStrategyInfo(
    inputs.agent_strategy_provider_name,
    inputs.agent_strategy_name,
  )
  const pluginId = inputs.agent_strategy_provider_name?.split('/').splice(0, 2).join('/')
  const pluginDetail = useCheckInstalled({
    pluginIds: [pluginId!],
    enabled: Boolean(pluginId),
  })
  const formData = useMemo(() => {
    const paramNameList = (currentStrategy?.parameters || []).map(item => item.name)
    return Object.fromEntries(
      Object.entries(inputs.agent_parameters || {}).filter(([name]) => paramNameList.includes(name)).map(([key, value]) => {
        return [key, value.value]
      }),
    )
  }, [inputs.agent_parameters, currentStrategy?.parameters])
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

  // vars

  const filterMemoryPromptVar = useCallback((varPayload: Var) => {
    return [
      VarKindType.arrayObject,
      VarKindType.array,
      VarKindType.number,
      VarKindType.string,
      VarKindType.secret,
      VarKindType.arrayString,
      VarKindType.arrayNumber,
      VarKindType.file,
      VarKindType.arrayFile,
    ].includes(varPayload.type)
  }, [])

  const {
    availableVars,
    availableNodesWithParent,
  } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: filterMemoryPromptVar,
  })

  // single run
  const {
    isShowSingleRun,
    showSingleRun,
    hideSingleRun,
    toVarInputs,
    runningStatus,
    handleRun,
    handleStop,
    runInputData,
    setRunInputData,
    runResult,
    getInputVars,
  } = useOneStepRun<AgentNodeType>({
    id,
    data: inputs,
    defaultRunInputData: {},
  })
  const allVarStrArr = (() => {
    const arr = currentStrategy?.parameters.filter(item => item.type === 'string').map((item) => {
      return formData[item.name]
    }) || []

    return arr
  })()
  const varInputs = (() => {
    const vars = getInputVars(allVarStrArr)

    return vars
  })()

  const outputSchema = useMemo(() => {
    const res: any[] = []
    if (!inputs.output_schema)
      return []
    Object.keys(inputs.output_schema.properties).forEach((outputKey) => {
      const output = inputs.output_schema.properties[outputKey]
      res.push({
        name: outputKey,
        type: output.type === 'array'
          ? `Array[${output.items?.type.slice(0, 1).toLocaleUpperCase()}${output.items?.type.slice(1)}]`
          : `${output.type.slice(0, 1).toLocaleUpperCase()}${output.type.slice(1)}`,
        description: output.description,
      })
    })
    return res
  }, [inputs.output_schema])

  const handleMemoryChange = useCallback((newMemory?: Memory) => {
    const newInputs = produce(inputs, (draft) => {
      draft.memory = newMemory
    })
    setInputs(newInputs)
  }, [inputs, setInputs])
  const isChatMode = useIsChatMode()
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
    pluginDetail: pluginDetail.data?.plugins.at(0),
    availableVars,
    availableNodesWithParent,

    isShowSingleRun,
    showSingleRun,
    hideSingleRun,
    toVarInputs,
    runningStatus,
    handleRun,
    handleStop,
    runInputData,
    setRunInputData,
    runResult,
    varInputs,
    outputSchema,
    handleMemoryChange,
    isChatMode,
  }
}

export default useConfig
