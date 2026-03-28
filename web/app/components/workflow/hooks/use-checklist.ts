import type { AgentNodeType } from '../nodes/agent/types'
import type { DataSourceNodeType } from '../nodes/data-source/types'
import type { KnowledgeBaseNodeType } from '../nodes/knowledge-base/types'
import type { KnowledgeRetrievalNodeType } from '../nodes/knowledge-retrieval/types'
import type { ToolNodeType } from '../nodes/tool/types'
import type { PluginTriggerNodeType } from '../nodes/trigger-plugin/types'
import type {
  CommonEdgeType,
  CommonNodeType,
  Edge,
  ModelConfig,
  Node,
  ValueSelector,
} from '../types'
import type { ModelItem } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Emoji } from '@/app/components/tools/types'
import type { DataSet } from '@/models/datasets'
import type { I18nKeysWithPrefix } from '@/types/i18n'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import isDeepEqual from 'fast-deep-equal'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useEdges, useStoreApi } from 'reactflow'
import { useStore as useAppStore } from '@/app/components/app/store'
import { toast } from '@/app/components/base/ui/toast'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import useNodes from '@/app/components/workflow/store/workflow/use-nodes'
import { MAX_TREE_DEPTH } from '@/config'
import { useGetLanguage } from '@/context/i18n'
import { useProviderContextSelector } from '@/context/provider-context'
import { consoleQuery } from '@/service/client'
import { fetchDatasets } from '@/service/datasets'
import { useStrategyProviders } from '@/service/use-strategy'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
} from '@/service/use-tools'
import { useAllTriggerPlugins } from '@/service/use-triggers'
import { AppModeEnum } from '@/types/app'
import {
  CUSTOM_NODE,
} from '../constants'
import { useDatasetsDetailStore } from '../datasets-detail-store/store'
import {
  useGetToolIcon,
  useNodesMetaData,
} from '../hooks'
import { getNodeUsedVars, isSpecialVar } from '../nodes/_base/components/variable/utils'
import { IndexMethodEnum } from '../nodes/knowledge-base/types'
import { getLLMModelIssue, isLLMModelProviderInstalled, LLMModelIssueCode } from '../nodes/llm/utils'
import {
  useStore,
  useWorkflowStore,
} from '../store'
import { BlockEnum } from '../types'
import {
  getDataSourceCheckParams,
  getToolCheckParams,
  getValidTreeNodes,
} from '../utils'
import { extractPluginId } from '../utils/plugin'
import { isNodePluginMissing } from '../utils/plugin-install-check'
import { getTriggerCheckParams } from '../utils/trigger'
import useNodesAvailableVarList, { useGetNodesAvailableVarList } from './use-nodes-available-var-list'

export type ChecklistItem = {
  id: string
  type: BlockEnum | string
  title: string
  toolIcon?: string | Emoji
  unConnected?: boolean
  errorMessages: string[]
  canNavigate: boolean
  disableGoTo?: boolean
  isPluginMissing?: boolean
  pluginUniqueIdentifier?: string
}

const START_NODE_TYPES: BlockEnum[] = [
  BlockEnum.Start,
  BlockEnum.TriggerSchedule,
  BlockEnum.TriggerWebhook,
  BlockEnum.TriggerPlugin,
]

export const useChecklist = (nodes: Node[], edges: Edge[]) => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const { nodesMap: nodesExtraData } = useNodesMetaData()
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()
  const dataSourceList = useStore(s => s.dataSourceList)
  const { data: strategyProviders } = useStrategyProviders()
  const { data: triggerPlugins } = useAllTriggerPlugins()
  const datasetsDetail = useDatasetsDetailStore(s => s.datasetsDetail)
  const getToolIcon = useGetToolIcon()
  const appMode = useAppStore.getState().appDetail?.mode
  const shouldCheckStartNode = appMode === AppModeEnum.WORKFLOW || appMode === AppModeEnum.ADVANCED_CHAT
  const modelProviders = useProviderContextSelector(s => s.modelProviders)
  const workflowStore = useWorkflowStore()

  const map = useNodesAvailableVarList(nodes)
  const { data: embeddingModelList } = useModelList(ModelTypeEnum.textEmbedding)
  const { data: rerankModelList } = useModelList(ModelTypeEnum.rerank)
  const knowledgeBaseEmbeddingProviders = useMemo(() => {
    const providers = new Set<string>()

    nodes.forEach((node) => {
      if (node.type !== CUSTOM_NODE || node.data.type !== BlockEnum.KnowledgeBase)
        return

      const knowledgeBaseData = node.data as CommonNodeType<KnowledgeBaseNodeType>
      if (knowledgeBaseData.indexing_technique !== IndexMethodEnum.QUALIFIED)
        return

      const provider = knowledgeBaseData.embedding_model_provider
      if (provider)
        providers.add(provider)
    })

    return [...providers]
  }, [nodes])
  const knowledgeBaseProviderModelMap = useQueries({
    queries: knowledgeBaseEmbeddingProviders.map(provider =>
      consoleQuery.modelProviders.models.queryOptions({
        input: { params: { provider } },
        enabled: !!provider,
        refetchOnWindowFocus: false,
        select: response => response.data,
      }),
    ),
    combine: (results) => {
      const modelMap: Partial<Record<string, ModelItem[]>> = {}
      knowledgeBaseEmbeddingProviders.forEach((provider, index) => {
        const models = results[index]?.data
        if (models)
          modelMap[provider] = models
      })
      return modelMap
    },
  })

  const getCheckData = useCallback((data: CommonNodeType<{}>) => {
    let checkData = data
    if (data.type === BlockEnum.KnowledgeRetrieval) {
      const datasetIds = (data as CommonNodeType<KnowledgeRetrievalNodeType>).dataset_ids
      const _datasets = datasetIds.reduce<DataSet[]>((acc, id) => {
        if (datasetsDetail[id])
          acc.push(datasetsDetail[id])
        return acc
      }, [])
      checkData = {
        ...data,
        _datasets,
      } as CommonNodeType<KnowledgeRetrievalNodeType>
    }
    else if (data.type === BlockEnum.KnowledgeBase) {
      const modelProviderName = (data as CommonNodeType<KnowledgeBaseNodeType>).embedding_model_provider
      checkData = {
        ...data,
        _embeddingModelList: embeddingModelList,
        _embeddingProviderModelList: modelProviderName ? knowledgeBaseProviderModelMap[modelProviderName] : undefined,
        _rerankModelList: rerankModelList,
      } as CommonNodeType<KnowledgeBaseNodeType>
    }
    return checkData
  }, [datasetsDetail, embeddingModelList, knowledgeBaseProviderModelMap, rerankModelList])

  const needWarningNodes = useMemo<ChecklistItem[]>(() => {
    const list: ChecklistItem[] = []
    const filteredNodes = nodes.filter(node => node.type === CUSTOM_NODE)
    const { validNodes } = getValidTreeNodes(filteredNodes, edges)
    const installedPluginIds = new Set(modelProviders.map(p => extractPluginId(p.provider)))

    for (let i = 0; i < filteredNodes.length; i++) {
      const node = filteredNodes[i]
      let moreDataForCheckValid
      let usedVars: ValueSelector[] = []

      if (node.data.type === BlockEnum.Tool)
        moreDataForCheckValid = getToolCheckParams(node.data as ToolNodeType, buildInTools || [], customTools || [], workflowTools || [], language)

      if (node.data.type === BlockEnum.DataSource)
        moreDataForCheckValid = getDataSourceCheckParams(node.data as DataSourceNodeType, dataSourceList || [], language)

      if (node.data.type === BlockEnum.TriggerPlugin)
        moreDataForCheckValid = getTriggerCheckParams(node.data as PluginTriggerNodeType, triggerPlugins, language)

      const toolIcon = getToolIcon(node.data)
      if (node.data.type === BlockEnum.Agent) {
        const data = node.data as AgentNodeType
        const isReadyForCheckValid = !!strategyProviders
        const provider = strategyProviders?.find(provider => provider.declaration.identity.name === data.agent_strategy_provider_name)
        const strategy = provider?.declaration.strategies?.find(s => s.identity.name === data.agent_strategy_name)
        moreDataForCheckValid = {
          provider,
          strategy,
          language,
          isReadyForCheckValid,
        }
      }
      else {
        usedVars = getNodeUsedVars(node).filter(v => v.length > 0)
      }

      if (node.type === CUSTOM_NODE) {
        const checkData = getCheckData(node.data)
        const validator = nodesExtraData?.[node.data.type as BlockEnum]?.checkValid
        const isPluginMissing = isNodePluginMissing(node.data, { builtInTools: buildInTools, customTools, workflowTools, mcpTools, triggerPlugins, dataSourceList })

        const errorMessages: string[] = []

        if (isPluginMissing) {
          errorMessages.push(t('nodes.common.pluginNotInstalled', { ns: 'workflow' }))
        }
        else {
          if (node.data.type === BlockEnum.LLM) {
            const modelProvider = (node.data as CommonNodeType<{ model?: ModelConfig }>).model?.provider
            const modelIssue = getLLMModelIssue({
              modelProvider,
              isModelProviderInstalled: isLLMModelProviderInstalled(modelProvider, installedPluginIds),
            })
            if (modelIssue === LLMModelIssueCode.providerPluginUnavailable)
              errorMessages.push(t('errorMsg.configureModel', { ns: 'workflow' }))
          }

          if (validator) {
            const validationError = validator(checkData, t, moreDataForCheckValid).errorMessage
            if (validationError)
              errorMessages.push(validationError)
          }

          const availableVars = map[node.id].availableVars
          let hasInvalidVar = false
          for (const variable of usedVars) {
            if (hasInvalidVar)
              break
            if (isSpecialVar(variable[0]))
              continue
            const usedNode = availableVars.find(v => v.nodeId === variable?.[0])
            if (!usedNode || !usedNode.vars.some(v => v.variable === variable?.[1]))
              hasInvalidVar = true
          }
          if (hasInvalidVar)
            errorMessages.push(t('errorMsg.invalidVariable', { ns: 'workflow' }))
        }

        const isStartNodeMeta = nodesExtraData?.[node.data.type as BlockEnum]?.metaData.isStart ?? false
        const canSkipConnectionCheck = shouldCheckStartNode ? isStartNodeMeta : true

        const isUnconnected = !validNodes.some(n => n.id === node.id)
        const shouldShowError = errorMessages.length > 0 || (isUnconnected && !canSkipConnectionCheck)

        if (shouldShowError) {
          list.push({
            id: node.id,
            type: node.data.type,
            title: node.data.title,
            toolIcon,
            unConnected: isUnconnected && !canSkipConnectionCheck,
            errorMessages,
            canNavigate: !isPluginMissing,
            disableGoTo: isPluginMissing,
            isPluginMissing,
            pluginUniqueIdentifier: isPluginMissing
              ? (node.data as { plugin_unique_identifier?: string }).plugin_unique_identifier
              : undefined,
          })
        }
      }
    }

    // Check for start nodes (including triggers)
    if (shouldCheckStartNode) {
      const startNodesFiltered = nodes.filter(node => START_NODE_TYPES.includes(node.data.type as BlockEnum))
      if (startNodesFiltered.length === 0) {
        list.push({
          id: 'start-node-required',
          type: BlockEnum.Start,
          title: t('panel.startNode', { ns: 'workflow' }),
          errorMessages: [t('common.needStartNode', { ns: 'workflow' })],
          canNavigate: false,
        })
      }
    }

    const isRequiredNodesType = Object.keys(nodesExtraData!).filter((key: any) => (nodesExtraData as any)[key].metaData.isRequired)

    isRequiredNodesType.forEach((type: string) => {
      if (!filteredNodes.some(node => node.data.type === type)) {
        list.push({
          id: `${type}-need-added`,
          type,
          title: t(`blocks.${type}` as I18nKeysWithPrefix<'workflow', 'blocks.'>, { ns: 'workflow' }),
          errorMessages: [t('common.needAdd', { ns: 'workflow', node: t(`blocks.${type}` as I18nKeysWithPrefix<'workflow', 'blocks.'>, { ns: 'workflow' }) })],
          canNavigate: false,
        })
      }
    })

    return list
  }, [nodes, edges, shouldCheckStartNode, nodesExtraData, buildInTools, customTools, workflowTools, mcpTools, language, dataSourceList, triggerPlugins, getToolIcon, strategyProviders, getCheckData, t, map, modelProviders])

  useEffect(() => {
    const currentChecklistItems = workflowStore.getState().checklistItems
    if (isDeepEqual(currentChecklistItems, needWarningNodes))
      return

    workflowStore.setState({ checklistItems: needWarningNodes })
  }, [needWarningNodes, workflowStore])

  return needWarningNodes
}

export const useChecklistBeforePublish = () => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const queryClient = useQueryClient()
  const store = useStoreApi()
  const { nodesMap: nodesExtraData } = useNodesMetaData()
  const { data: strategyProviders } = useStrategyProviders()
  const modelProviders = useProviderContextSelector(s => s.modelProviders)
  const updateDatasetsDetail = useDatasetsDetailStore(s => s.updateDatasetsDetail)
  const updateTimeRef = useRef(0)
  const workflowStore = useWorkflowStore()
  const { getNodesAvailableVarList } = useGetNodesAvailableVarList()
  const { data: embeddingModelList } = useModelList(ModelTypeEnum.textEmbedding)
  const { data: rerankModelList } = useModelList(ModelTypeEnum.rerank)
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const appMode = useAppStore.getState().appDetail?.mode
  const shouldCheckStartNode = appMode === AppModeEnum.WORKFLOW || appMode === AppModeEnum.ADVANCED_CHAT

  const getCheckData = useCallback((
    data: CommonNodeType<object>,
    datasets: DataSet[],
    embeddingProviderModelMap?: Partial<Record<string, ModelItem[]>>,
  ) => {
    let checkData = data
    if (data.type === BlockEnum.KnowledgeRetrieval) {
      const datasetIds = (data as CommonNodeType<KnowledgeRetrievalNodeType>).dataset_ids
      const datasetsDetail = datasets.reduce<Record<string, DataSet>>((acc, dataset) => {
        acc[dataset.id] = dataset
        return acc
      }, {})
      const _datasets = datasetIds.reduce<DataSet[]>((acc, id) => {
        if (datasetsDetail[id])
          acc.push(datasetsDetail[id])
        return acc
      }, [])
      checkData = {
        ...data,
        _datasets,
      } as CommonNodeType<KnowledgeRetrievalNodeType>
    }
    else if (data.type === BlockEnum.KnowledgeBase) {
      const modelProviderName = (data as CommonNodeType<KnowledgeBaseNodeType>).embedding_model_provider
      checkData = {
        ...data,
        _embeddingModelList: embeddingModelList,
        _embeddingProviderModelList: modelProviderName ? embeddingProviderModelMap?.[modelProviderName] : undefined,
        _rerankModelList: rerankModelList,
      } as CommonNodeType<KnowledgeBaseNodeType>
    }
    return checkData
  }, [embeddingModelList, rerankModelList])

  const handleCheckBeforePublish = useCallback(async () => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const {
      dataSourceList,
    } = workflowStore.getState()
    const nodes = getNodes()
    const filteredNodes = nodes.filter(node => node.type === CUSTOM_NODE)
    const { validNodes, maxDepth } = getValidTreeNodes(filteredNodes, edges)

    if (maxDepth > MAX_TREE_DEPTH) {
      toast.error(t('common.maxTreeDepth', { ns: 'workflow', depth: MAX_TREE_DEPTH }))
      return false
    }

    const knowledgeBaseEmbeddingProviders = [...new Set(
      filteredNodes
        .filter(node => node.data.type === BlockEnum.KnowledgeBase)
        .map(node => node.data as CommonNodeType<KnowledgeBaseNodeType>)
        .filter(node => node.indexing_technique === IndexMethodEnum.QUALIFIED)
        .map(node => node.embedding_model_provider)
        .filter((provider): provider is string => !!provider),
    )]

    const fetchKnowledgeBaseProviderModelMap = async () => {
      const modelMap: Partial<Record<string, ModelItem[]>> = {}
      await Promise.all(knowledgeBaseEmbeddingProviders.map(async (provider) => {
        try {
          const modelList = await queryClient.fetchQuery(
            consoleQuery.modelProviders.models.queryOptions({
              input: { params: { provider } },
            }),
          )

          if (modelList.data)
            modelMap[provider] = modelList.data
        }
        catch {
        }
      }))
      return modelMap
    }

    const fetchLatestDatasets = async (): Promise<DataSet[] | null> => {
      const allDatasetIds = new Set<string>()
      filteredNodes.forEach((node) => {
        if (node.data.type !== BlockEnum.KnowledgeRetrieval)
          return

        const datasetIds = (node.data as CommonNodeType<KnowledgeRetrievalNodeType>).dataset_ids
        datasetIds.forEach(id => allDatasetIds.add(id))
      })

      if (allDatasetIds.size === 0)
        return []

      updateTimeRef.current = updateTimeRef.current + 1
      const currUpdateTime = updateTimeRef.current
      const { data: datasetsDetail } = await fetchDatasets({ url: '/datasets', params: { page: 1, ids: [...allDatasetIds] } })
      if (currUpdateTime < updateTimeRef.current)
        return null
      if (datasetsDetail?.length)
        updateDatasetsDetail(datasetsDetail)
      return datasetsDetail || []
    }

    const [embeddingProviderModelMap, datasets] = await Promise.all([
      fetchKnowledgeBaseProviderModelMap(),
      fetchLatestDatasets(),
    ])

    if (datasets === null)
      return false

    const installedPluginIds = new Set(modelProviders.map(p => extractPluginId(p.provider)))
    const map = getNodesAvailableVarList(nodes)
    for (let i = 0; i < filteredNodes.length; i++) {
      const node = filteredNodes[i]
      let moreDataForCheckValid
      let usedVars: ValueSelector[] = []
      if (node.data.type === BlockEnum.Tool)
        moreDataForCheckValid = getToolCheckParams(node.data as ToolNodeType, buildInTools || [], customTools || [], workflowTools || [], language)

      if (node.data.type === BlockEnum.DataSource)
        moreDataForCheckValid = getDataSourceCheckParams(node.data as DataSourceNodeType, dataSourceList || [], language)

      if (node.data.type === BlockEnum.Agent) {
        const data = node.data as AgentNodeType
        const isReadyForCheckValid = !!strategyProviders
        const provider = strategyProviders?.find(provider => provider.declaration.identity.name === data.agent_strategy_provider_name)
        const strategy = provider?.declaration.strategies?.find(s => s.identity.name === data.agent_strategy_name)
        moreDataForCheckValid = {
          provider,
          strategy,
          language,
          isReadyForCheckValid,
        }
      }
      else {
        usedVars = getNodeUsedVars(node).filter(v => v.length > 0)
      }

      if (node.data.type === BlockEnum.LLM) {
        const modelProvider = (node.data as CommonNodeType<{ model?: ModelConfig }>).model?.provider
        const modelIssue = getLLMModelIssue({
          modelProvider,
          isModelProviderInstalled: isLLMModelProviderInstalled(modelProvider, installedPluginIds),
        })
        if (modelIssue === LLMModelIssueCode.providerPluginUnavailable) {
          toast.error(`[${node.data.title}] ${t('errorMsg.configureModel', { ns: 'workflow' })}`)
          return false
        }
      }

      const checkData = getCheckData(node.data, datasets, embeddingProviderModelMap)
      const { errorMessage } = nodesExtraData![node.data.type as BlockEnum].checkValid(checkData, t, moreDataForCheckValid)

      if (errorMessage) {
        toast.error(`[${node.data.title}] ${errorMessage}`)
        return false
      }

      const availableVars = map[node.id].availableVars

      for (const variable of usedVars) {
        const isSpecialVars = isSpecialVar(variable[0])
        if (!isSpecialVars) {
          const usedNode = availableVars.find(v => v.nodeId === variable?.[0])
          if (usedNode) {
            const usedVar = usedNode.vars.find(v => v.variable === variable?.[1])
            if (!usedVar) {
              toast.error(`[${node.data.title}] ${t('errorMsg.invalidVariable', { ns: 'workflow' })}`)
              return false
            }
          }
          else {
            toast.error(`[${node.data.title}] ${t('errorMsg.invalidVariable', { ns: 'workflow' })}`)
            return false
          }
        }
      }

      const isStartNodeMeta = nodesExtraData?.[node.data.type as BlockEnum]?.metaData.isStart ?? false
      const canSkipConnectionCheck = shouldCheckStartNode ? isStartNodeMeta : true
      const isUnconnected = !validNodes.some(n => n.id === node.id)

      if (isUnconnected && !canSkipConnectionCheck) {
        toast.error(`[${node.data.title}] ${t('common.needConnectTip', { ns: 'workflow' })}`)
        return false
      }
    }

    if (shouldCheckStartNode) {
      const startNodesFiltered = nodes.filter(node => START_NODE_TYPES.includes(node.data.type as BlockEnum))
      if (startNodesFiltered.length === 0) {
        toast.error(t('common.needStartNode', { ns: 'workflow' }))
        return false
      }
    }

    const isRequiredNodesType = Object.keys(nodesExtraData!).filter((key: any) => (nodesExtraData as any)[key].metaData.isRequired)

    for (let i = 0; i < isRequiredNodesType.length; i++) {
      const type = isRequiredNodesType[i]

      if (!filteredNodes.some(node => node.data.type === type)) {
        toast.error(t('common.needAdd', { ns: 'workflow', node: t(`blocks.${type}` as I18nKeysWithPrefix<'workflow', 'blocks.'>, { ns: 'workflow' }) }))
        return false
      }
    }

    return true
  }, [store, workflowStore, getNodesAvailableVarList, shouldCheckStartNode, nodesExtraData, t, updateDatasetsDetail, buildInTools, customTools, workflowTools, language, getCheckData, queryClient, strategyProviders, modelProviders])

  return {
    handleCheckBeforePublish,
  }
}

export const useWorkflowRunValidation = () => {
  const { t } = useTranslation()
  const nodes = useNodes()
  const edges = useEdges<CommonEdgeType>()
  const needWarningNodes = useChecklist(nodes, edges)

  const validateBeforeRun = useCallback(() => {
    if (needWarningNodes.length > 0) {
      toast.error(t('panel.checklistTip', { ns: 'workflow' }))
      return false
    }
    return true
  }, [needWarningNodes, t])

  return {
    validateBeforeRun,
    hasValidationErrors: needWarningNodes.length > 0,
    warningNodes: needWarningNodes,
  }
}
