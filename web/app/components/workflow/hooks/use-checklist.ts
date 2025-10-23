import {
  useCallback,
  useMemo,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useEdges, useNodes, useStoreApi } from 'reactflow'
import type {
  CommonEdgeType,
  CommonNodeType,
  Edge,
  Node,
  ValueSelector,
} from '../types'
import { BlockEnum } from '../types'
import {
  useStore,
  useWorkflowStore,
} from '../store'
import {
  getDataSourceCheckParams,
  getToolCheckParams,
  getValidTreeNodes,
} from '../utils'
import { getTriggerCheckParams } from '../utils/trigger'
import {
  CUSTOM_NODE,
} from '../constants'
import {
  useGetToolIcon,
  useNodesMetaData,
} from '../hooks'
import type { ToolNodeType } from '../nodes/tool/types'
import type { DataSourceNodeType } from '../nodes/data-source/types'
import type { PluginTriggerNodeType } from '../nodes/trigger-plugin/types'
import { useToastContext } from '@/app/components/base/toast'
import { useGetLanguage } from '@/context/i18n'
import type { AgentNodeType } from '../nodes/agent/types'
import { useStrategyProviders } from '@/service/use-strategy'
import { useAllTriggerPlugins } from '@/service/use-triggers'
import { useDatasetsDetailStore } from '../datasets-detail-store/store'
import type { KnowledgeRetrievalNodeType } from '../nodes/knowledge-retrieval/types'
import type { DataSet } from '@/models/datasets'
import { fetchDatasets } from '@/service/datasets'
import { MAX_TREE_DEPTH } from '@/config'
import useNodesAvailableVarList, { useGetNodesAvailableVarList } from './use-nodes-available-var-list'
import { getNodeUsedVars, isSpecialVar } from '../nodes/_base/components/variable/utils'
import type { Emoji } from '@/app/components/tools/types'
import { useModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { KnowledgeBaseNodeType } from '../nodes/knowledge-base/types'

export type ChecklistItem = {
  id: string
  type: BlockEnum | string
  title: string
  toolIcon?: string | Emoji
  unConnected?: boolean
  errorMessage?: string
  canNavigate: boolean
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
  const buildInTools = useStore(s => s.buildInTools)
  const customTools = useStore(s => s.customTools)
  const workflowTools = useStore(s => s.workflowTools)
  const dataSourceList = useStore(s => s.dataSourceList)
  const { data: strategyProviders } = useStrategyProviders()
  const { data: triggerPlugins } = useAllTriggerPlugins()
  const datasetsDetail = useDatasetsDetailStore(s => s.datasetsDetail)
  const getToolIcon = useGetToolIcon()

  const map = useNodesAvailableVarList(nodes)
  const { data: embeddingModelList } = useModelList(ModelTypeEnum.textEmbedding)
  const { data: rerankModelList } = useModelList(ModelTypeEnum.rerank)

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
      checkData = {
        ...data,
        _embeddingModelList: embeddingModelList,
        _rerankModelList: rerankModelList,
      } as CommonNodeType<KnowledgeBaseNodeType>
    }
    return checkData
  }, [datasetsDetail, embeddingModelList, rerankModelList])

  const needWarningNodes = useMemo<ChecklistItem[]>(() => {
    const list: ChecklistItem[] = []
    const filteredNodes = nodes.filter(node => node.type === CUSTOM_NODE)
    const { validNodes } = getValidTreeNodes(filteredNodes, edges)

    for (let i = 0; i < filteredNodes.length; i++) {
      const node = filteredNodes[i]
      let moreDataForCheckValid
      let usedVars: ValueSelector[] = []

      if (node.data.type === BlockEnum.Tool)
        moreDataForCheckValid = getToolCheckParams(node.data as ToolNodeType, buildInTools, customTools, workflowTools, language)

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
        let { errorMessage } = nodesExtraData![node.data.type]?.checkValid(checkData, t, moreDataForCheckValid)

        if (!errorMessage) {
          const availableVars = map[node.id].availableVars

          for (const variable of usedVars) {
            const isSpecialVars = isSpecialVar(variable[0])
            if (!isSpecialVars) {
              const usedNode = availableVars.find(v => v.nodeId === variable?.[0])
              if (usedNode) {
                const usedVar = usedNode.vars.find(v => v.variable === variable?.[1])
                if (!usedVar)
                  errorMessage = t('workflow.errorMsg.invalidVariable')
              }
              else {
                errorMessage = t('workflow.errorMsg.invalidVariable')
              }
            }
          }
        }

        // Start nodes and Trigger nodes should not show unConnected error if they have validation errors
        // or if they are valid start nodes (even without incoming connections)
        const isStartNode = nodesExtraData?.[node.data.type as BlockEnum]?.metaData.isStart || false

        const isUnconnected = !validNodes.find(n => n.id === node.id)
        const shouldShowError = errorMessage || (isUnconnected && !isStartNode)

        if (shouldShowError) {
          list.push({
            id: node.id,
            type: node.data.type,
            title: node.data.title,
            toolIcon,
            unConnected: isUnconnected && !isStartNode,
            errorMessage,
            canNavigate: true,
          })
        }
      }
    }

    // Check for start nodes (including triggers)
    const startNodesFiltered = nodes.filter(node => START_NODE_TYPES.includes(node.data.type as BlockEnum))

    if (startNodesFiltered.length === 0) {
      list.push({
        id: 'start-node-required',
        type: BlockEnum.Start,
        title: t('workflow.panel.startNode'),
        errorMessage: t('workflow.common.needStartNode'),
        canNavigate: false,
      })
    }

    const isRequiredNodesType = Object.keys(nodesExtraData!).filter((key: any) => (nodesExtraData as any)[key].metaData.isRequired)

    isRequiredNodesType.forEach((type: string) => {
      if (!filteredNodes.find(node => node.data.type === type)) {
        list.push({
          id: `${type}-need-added`,
          type,
          title: t(`workflow.blocks.${type}`),
          errorMessage: t('workflow.common.needAdd', { node: t(`workflow.blocks.${type}`) }),
          canNavigate: false,
        })
      }
    })

    return list
  }, [nodes, nodesExtraData, edges, buildInTools, customTools, workflowTools, language, dataSourceList, getToolIcon, strategyProviders, getCheckData, t, map])

  return needWarningNodes
}

export const useChecklistBeforePublish = () => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const { notify } = useToastContext()
  const store = useStoreApi()
  const { nodesMap: nodesExtraData } = useNodesMetaData()
  const { data: strategyProviders } = useStrategyProviders()
  const updateDatasetsDetail = useDatasetsDetailStore(s => s.updateDatasetsDetail)
  const updateTime = useRef(0)
  const workflowStore = useWorkflowStore()
  const { getNodesAvailableVarList } = useGetNodesAvailableVarList()
  const { data: embeddingModelList } = useModelList(ModelTypeEnum.textEmbedding)
  const { data: rerankModelList } = useModelList(ModelTypeEnum.rerank)

  const getCheckData = useCallback((data: CommonNodeType<{}>, datasets: DataSet[]) => {
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
      checkData = {
        ...data,
        _embeddingModelList: embeddingModelList,
        _rerankModelList: rerankModelList,
      } as CommonNodeType<KnowledgeBaseNodeType>
    }
    return checkData
  }, [])

  const handleCheckBeforePublish = useCallback(async () => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const {
      dataSourceList,
      buildInTools,
      customTools,
      workflowTools,
    } = workflowStore.getState()
    const nodes = getNodes()
    const filteredNodes = nodes.filter(node => node.type === CUSTOM_NODE)
    const { validNodes, maxDepth } = getValidTreeNodes(filteredNodes, edges)

    if (maxDepth > MAX_TREE_DEPTH) {
      notify({ type: 'error', message: t('workflow.common.maxTreeDepth', { depth: MAX_TREE_DEPTH }) })
      return false
    }
    // Before publish, we need to fetch datasets detail, in case of the settings of datasets have been changed
    const knowledgeRetrievalNodes = filteredNodes.filter(node => node.data.type === BlockEnum.KnowledgeRetrieval)
    const allDatasetIds = knowledgeRetrievalNodes.reduce<string[]>((acc, node) => {
      return Array.from(new Set([...acc, ...(node.data as CommonNodeType<KnowledgeRetrievalNodeType>).dataset_ids]))
    }, [])
    let datasets: DataSet[] = []
    if (allDatasetIds.length > 0) {
      updateTime.current = updateTime.current + 1
      const currUpdateTime = updateTime.current
      const { data: datasetsDetail } = await fetchDatasets({ url: '/datasets', params: { page: 1, ids: allDatasetIds } })
      if (datasetsDetail && datasetsDetail.length > 0) {
        // avoid old data to overwrite the new data
        if (currUpdateTime < updateTime.current)
          return false
        datasets = datasetsDetail
        updateDatasetsDetail(datasetsDetail)
      }
    }
    const map = getNodesAvailableVarList(nodes)
    for (let i = 0; i < filteredNodes.length; i++) {
      const node = filteredNodes[i]
      let moreDataForCheckValid
      let usedVars: ValueSelector[] = []
      if (node.data.type === BlockEnum.Tool)
        moreDataForCheckValid = getToolCheckParams(node.data as ToolNodeType, buildInTools, customTools, workflowTools, language)

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
      const checkData = getCheckData(node.data, datasets)
      const { errorMessage } = nodesExtraData![node.data.type as BlockEnum].checkValid(checkData, t, moreDataForCheckValid)

      if (errorMessage) {
        notify({ type: 'error', message: `[${node.data.title}] ${errorMessage}` })
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
              notify({ type: 'error', message: `[${node.data.title}] ${t('workflow.errorMsg.invalidVariable')}` })
              return false
            }
          }
          else {
            notify({ type: 'error', message: `[${node.data.title}] ${t('workflow.errorMsg.invalidVariable')}` })
            return false
          }
        }
      }

      if (!validNodes.find(n => n.id === node.id)) {
        notify({ type: 'error', message: `[${node.data.title}] ${t('workflow.common.needConnectTip')}` })
        return false
      }
    }

    const startNodesFiltered = nodes.filter(node => START_NODE_TYPES.includes(node.data.type as BlockEnum))

    if (startNodesFiltered.length === 0) {
      notify({ type: 'error', message: t('workflow.common.needStartNode') })
      return false
    }

    const isRequiredNodesType = Object.keys(nodesExtraData!).filter((key: any) => (nodesExtraData as any)[key].metaData.isRequired)

    for (let i = 0; i < isRequiredNodesType.length; i++) {
      const type = isRequiredNodesType[i]

      if (!filteredNodes.find(node => node.data.type === type)) {
        notify({ type: 'error', message: t('workflow.common.needAdd', { node: t(`workflow.blocks.${type}`) }) })
        return false
      }
    }

    return true
  }, [store, notify, t, language, nodesExtraData, strategyProviders, updateDatasetsDetail, getCheckData, workflowStore])

  return {
    handleCheckBeforePublish,
  }
}

export const useWorkflowRunValidation = () => {
  const { t } = useTranslation()
  const nodes = useNodes<CommonNodeType>()
  const edges = useEdges<CommonEdgeType>()
  const needWarningNodes = useChecklist(nodes, edges)
  const { notify } = useToastContext()

  const validateBeforeRun = useCallback(() => {
    if (needWarningNodes.length > 0) {
      notify({ type: 'error', message: t('workflow.panel.checklistTip') })
      return false
    }
    return true
  }, [needWarningNodes, notify, t])

  return {
    validateBeforeRun,
    hasValidationErrors: needWarningNodes.length > 0,
  }
}
