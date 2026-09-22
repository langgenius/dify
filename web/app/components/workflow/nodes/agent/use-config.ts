import type { Memory, Var } from '../../types'
import type { AgentNodeType } from './types'
import type { ResourceVarInputs } from '@/app/components/workflow/nodes/_base/types'
import { skipToken, useQuery } from '@tanstack/react-query'
import { produce } from 'immer'
import { useCallback, useEffect, useMemo } from 'react'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  generateAgentToolValue,
  toolParametersToFormSchemas,
} from '@/app/components/tools/utils/to-form-schema'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { consoleQuery } from '@/service/console'
import { useCheckInstalled, useFetchPluginsInMarketPlaceByIds } from '@/service/use-plugins'
import { useIsChatMode, useNodesReadOnly } from '../../hooks/use-workflow'
import { VarType } from '../../types'
import useAvailableVarList from '../_base/hooks/use-available-var-list'
import useNodeCrud from '../_base/hooks/use-node-crud'
import useVarList from '../_base/hooks/use-var-list'

type StrategyStatus = {
  plugin: {
    source: 'external' | 'marketplace'
    installed: boolean
  }
  isExistInPlugin: boolean
}

export const useStrategyInfo = (strategyProviderName?: string, strategyName?: string) => {
  const strategyProvider = useQuery(
    consoleQuery.workspaces.current.agentProvider.byProviderName.get.queryOptions({
      input: strategyProviderName ? { params: { provider_name: strategyProviderName } } : skipToken,
      retry: false,
    }),
  )
  const strategy = strategyProvider.data?.declaration.strategies?.find(
    (str) => str.identity.name === strategyName,
  )
  const marketplace = useFetchPluginsInMarketPlaceByIds(
    strategyProviderName ? [strategyProviderName] : [],
    {
      retry: false,
    },
  )
  const strategyStatus: StrategyStatus | undefined = useMemo(() => {
    if (!strategyProviderName || strategyProvider.isLoading || marketplace.isLoading)
      return undefined
    const strategyExist = !!strategy
    const isPluginInstalled = strategyProvider.isSuccess
    const isInMarketplace = !!marketplace.data?.data.plugins.at(0)
    return {
      plugin: {
        source: isInMarketplace ? 'marketplace' : 'external',
        installed: isPluginInstalled,
      },
      isExistInPlugin: strategyExist,
    }
  }, [
    strategy,
    strategyProviderName,
    marketplace,
    strategyProvider.isSuccess,
    strategyProvider.isLoading,
  ])
  const { refetch: refetchProvider } = strategyProvider
  const { refetch: refetchMarketplace } = marketplace
  const refetch = useCallback(() => {
    if (!strategyProviderName) return
    return Promise.all([refetchProvider(), refetchMarketplace()])
  }, [refetchMarketplace, refetchProvider, strategyProviderName])
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
  } = useStrategyInfo(inputs.agent_strategy_provider_name, inputs.agent_strategy_name)
  const pluginId = inputs.agent_strategy_provider_name?.split('/').splice(0, 2).join('/')
  const pluginDetail = useCheckInstalled({
    pluginIds: pluginId ? [pluginId] : [],
    enabled: Boolean(pluginId),
  })
  const formData = useMemo(() => {
    const paramNameList = (currentStrategy?.parameters || []).map((item) => item.name)
    const res = Object.fromEntries(
      Object.entries(inputs.agent_parameters || {})
        .filter(([name]) => paramNameList.includes(name))
        .map(([key, value]) => {
          return [key, value.value]
        }),
    )
    return res
  }, [inputs.agent_parameters, currentStrategy?.parameters])

  const getParamVarType = useCallback(
    (paramName: string) => {
      const isVariable = currentStrategy?.parameters?.some(
        (param) => param.name === paramName && param.type === FormTypeEnum.any,
      )
      if (isVariable) return VarKindType.variable
      return VarKindType.constant
    },
    [currentStrategy?.parameters],
  )

  const onFormChange = (value: Record<string, unknown>) => {
    const res: ResourceVarInputs = { ...inputs.agent_parameters }
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
    const settingValues = generateAgentToolValue(
      data.settings,
      toolParametersToFormSchemas(
        data.schemas.filter((param: { form: string }) => param.form !== 'llm') as any,
      ),
    )
    const paramValues = generateAgentToolValue(
      data.parameters,
      toolParametersToFormSchemas(
        data.schemas.filter((param: { form: string }) => param.form === 'llm') as any,
      ),
      true,
    )
    const res = produce(data, (draft: any) => {
      draft.settings = settingValues
      draft.parameters = paramValues
    })
    return res
  }

  const formattingLegacyData = () => {
    if (inputs.version || inputs.tool_node_version) return inputs
    const newData = produce(inputs, (draft) => {
      const schemas = currentStrategy?.parameters || []
      Object.keys(draft.agent_parameters || {}).forEach((key) => {
        const targetSchema = schemas.find((schema) => schema.name === key)
        if (targetSchema?.type === FormTypeEnum.multiToolSelector)
          draft.agent_parameters![key]!.value = draft.agent_parameters![key]!.value.map(
            (tool: any) => formattingToolData(tool),
          )
      })
      draft.tool_node_version = '2'
    })
    return newData
  }

  // formatting legacy data
  useEffect(() => {
    if (!currentStrategy) return
    const newData = formattingLegacyData()
    setInputs(newData)
  }, [currentStrategy])

  // vars

  const filterMemoryPromptVar = useCallback((varPayload: Var) => {
    const supportedVariableTypes: readonly VarType[] = [
      VarType.arrayObject,
      VarType.array,
      VarType.number,
      VarType.string,
      VarType.secret,
      VarType.arrayString,
      VarType.arrayNumber,
      VarType.file,
      VarType.arrayFile,
    ]

    return supportedVariableTypes.includes(varPayload.type)
  }, [])

  const { availableVars, availableNodesWithParent } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: filterMemoryPromptVar,
  })

  // single run

  const outputSchema = useMemo(() => {
    const properties = inputs.output_schema?.properties
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return []
    return Object.entries(properties).map(([name, output]: [string, unknown]) => {
      const schema = output && typeof output === 'object' && !Array.isArray(output) ? output : {}
      const type =
        'type' in schema && typeof schema.type === 'string' && schema.type ? schema.type : 'unknown'
      const items = 'items' in schema ? schema.items : undefined
      const itemType =
        items &&
        typeof items === 'object' &&
        'type' in items &&
        typeof items.type === 'string' &&
        items.type
          ? items.type
          : 'unknown'
      return {
        name,
        type:
          type === 'array'
            ? `Array[${itemType.charAt(0).toUpperCase()}${itemType.slice(1)}]`
            : `${type.charAt(0).toUpperCase()}${type.slice(1)}`,
        description:
          'description' in schema && typeof schema.description === 'string'
            ? schema.description
            : '',
      }
    })
  }, [inputs.output_schema])

  const handleMemoryChange = useCallback(
    (newMemory?: Memory) => {
      const newInputs = produce(inputs, (draft) => {
        draft.memory = newMemory
      })
      setInputs(newInputs)
    },
    [inputs, setInputs],
  )
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
  }
}

export default useConfig
