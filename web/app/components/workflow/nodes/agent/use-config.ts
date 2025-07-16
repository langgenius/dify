import { useStrategyProviderDetail } from '@/service/use-strategy'
import useNodeCrud from '../_base/hooks/use-node-crud'
import useVarList from '../_base/hooks/use-var-list'
import type { AgentNodeType } from './types'
import {
  useIsChatMode,
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'
import { useCallback, useEffect, useMemo } from 'react'
import { type ToolVarInputs, VarType } from '../tool/types'
import { useCheckInstalled, useFetchPluginsInMarketPlaceByIds } from '@/service/use-plugins'
import type { Memory, Var } from '../../types'
import { VarType as VarKindType } from '../../types'
import useAvailableVarList from '../_base/hooks/use-available-var-list'
import produce from 'immer'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { isSupportMCP } from '@/utils/plugin-version-feature'
import { generateAgentToolValue, toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'

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
    const res = Object.fromEntries(
      Object.entries(inputs.agent_parameters || {}).filter(([name]) => paramNameList.includes(name)).map(([key, value]) => {
        return [key, value.value]
      }),
    )
    return res
  }, [inputs.agent_parameters, currentStrategy?.parameters])

  const getParamVarType = useCallback((paramName: string) => {
    const isVariable = currentStrategy?.parameters.some(
      param => param.name === paramName && param.type === FormTypeEnum.any,
    )
    if (isVariable) return VarType.variable
    return VarType.constant
  }, [currentStrategy?.parameters])

  const onFormChange = (value: Record<string, any>) => {
    const res: ToolVarInputs = {}
    Object.entries(value).forEach(([key, val]) => {
      res[key] = {
        type: getParamVarType(key),
        value: val,
      }
    })
    setInputs({
      ...inputs,
      agent_parameters: res,
    })
  }

  const formattingToolData = (data: any) => {
    const settingValues = generateAgentToolValue(data.settings, toolParametersToFormSchemas(data.schemas.filter((param: { form: string }) => param.form !== 'llm') as any))
    const paramValues = generateAgentToolValue(data.parameters, toolParametersToFormSchemas(data.schemas.filter((param: { form: string }) => param.form === 'llm') as any), true)
    const res = produce(data, (draft: any) => {
      draft.settings = settingValues
      draft.parameters = paramValues
    })
    return res
  }

  const formattingLegacyData = () => {
    if (inputs.version)
      return inputs
    const newData = produce(inputs, (draft) => {
      const schemas = currentStrategy?.parameters || []
      Object.keys(draft.agent_parameters || {}).forEach((key) => {
        const targetSchema = schemas.find(schema => schema.name === key)
        if (targetSchema?.type === FormTypeEnum.toolSelector)
          draft.agent_parameters![key].value = formattingToolData(draft.agent_parameters![key].value)
        if (targetSchema?.type === FormTypeEnum.multiToolSelector)
          draft.agent_parameters![key].value = draft.agent_parameters![key].value.map((tool: any) => formattingToolData(tool))
      })
      draft.version = '2'
    })
    return newData
  }

  // formatting legacy data
  useEffect(() => {
    if (!currentStrategy)
      return
    const newData = formattingLegacyData()
    setInputs(newData)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStrategy])

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
    outputSchema,
    handleMemoryChange,
    isChatMode,
    canChooseMCPTool: isSupportMCP(inputs.meta?.version),
  }
}

export default useConfig
