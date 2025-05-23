import {
  useCallback,
  useMemo,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import type {
  CommonNodeType,
  Edge,
  Node,
} from '../types'
import { BlockEnum } from '../types'
import { useStore } from '../store'
import {
  getToolCheckParams,
  getValidTreeNodes,
} from '../utils'
import {
  CUSTOM_NODE,
  MAX_TREE_DEPTH,
} from '../constants'
import { useWorkflow } from '../hooks'
import type { ToolNodeType } from '../nodes/tool/types'
import { useNodesMetaData } from './use-nodes-meta-data'
import { useToastContext } from '@/app/components/base/toast'
import { CollectionType } from '@/app/components/tools/types'
import { useGetLanguage } from '@/context/i18n'
import type { AgentNodeType } from '../nodes/agent/types'
import { useStrategyProviders } from '@/service/use-strategy'
import { canFindTool } from '@/utils'
import { useDatasetsDetailStore } from '../datasets-detail-store/store'
import type { KnowledgeRetrievalNodeType } from '../nodes/knowledge-retrieval/types'
import type { DataSet } from '@/models/datasets'
import { fetchDatasets } from '@/service/datasets'

export const useChecklist = (nodes: Node[], edges: Edge[]) => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const { nodesMap: nodesExtraData } = useNodesMetaData()
  const buildInTools = useStore(s => s.buildInTools)
  const customTools = useStore(s => s.customTools)
  const workflowTools = useStore(s => s.workflowTools)
  const { data: strategyProviders } = useStrategyProviders()
  const datasetsDetail = useDatasetsDetailStore(s => s.datasetsDetail)
  const { getStartNodes } = useWorkflow()

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
    return checkData
  }, [datasetsDetail])

  const needWarningNodes = useMemo(() => {
    const list = []
    const filteredNodes = nodes.filter(node => node.type === CUSTOM_NODE)
    const startNodes = getStartNodes(filteredNodes)
    const validNodesFlattened = startNodes.map(startNode => getValidTreeNodes(startNode, filteredNodes, edges))
    const validNodes = validNodesFlattened.reduce((acc, curr) => {
      if (curr.validNodes)
        acc.push(...curr.validNodes)
      return acc
    }, [] as Node[])

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      let toolIcon
      let moreDataForCheckValid

      if (node.data.type === BlockEnum.Tool) {
        const { provider_type } = node.data

        moreDataForCheckValid = getToolCheckParams(node.data as ToolNodeType, buildInTools, customTools, workflowTools, language)
        if (provider_type === CollectionType.builtIn)
          toolIcon = buildInTools.find(tool => canFindTool(tool.id, node.data.provider_id || ''))?.icon

        if (provider_type === CollectionType.custom)
          toolIcon = customTools.find(tool => tool.id === node.data.provider_id)?.icon

        if (provider_type === CollectionType.workflow)
          toolIcon = workflowTools.find(tool => tool.id === node.data.provider_id)?.icon
      }

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

      if (node.type === CUSTOM_NODE) {
        const checkData = getCheckData(node.data)
        const { errorMessage } = nodesExtraData![node.data.type].checkValid(checkData, t, moreDataForCheckValid)
        if (errorMessage || !validNodes.find(n => n.id === node.id)) {
          list.push({
            id: node.id,
            type: node.data.type,
            title: node.data.title,
            toolIcon,
            unConnected: !validNodes.find(n => n.id === node.id),
            errorMessage,
          })
        }
      }
    }

    const isRequiredNodesType = Object.keys(nodesExtraData!).filter((key: any) => (nodesExtraData as any)[key].metaData.isRequired)

    isRequiredNodesType.forEach((type: string) => {
      if (!nodes.find(node => node.data.type === type)) {
        list.push({
          id: `${type}-need-added`,
          type,
          title: t(`workflow.blocks.${type}`),
          errorMessage: t('workflow.common.needAdd', { node: t(`workflow.blocks.${type}`) }),
        })
      }
    })

    return list
  }, [nodes, edges, buildInTools, customTools, workflowTools, language, nodesExtraData, t, strategyProviders, getCheckData, getStartNodes])

  return needWarningNodes
}

export const useChecklistBeforePublish = () => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const buildInTools = useStore(s => s.buildInTools)
  const customTools = useStore(s => s.customTools)
  const workflowTools = useStore(s => s.workflowTools)
  const { notify } = useToastContext()
  const store = useStoreApi()
  const { nodesMap: nodesExtraData } = useNodesMetaData()
  const { data: strategyProviders } = useStrategyProviders()
  const updateDatasetsDetail = useDatasetsDetailStore(s => s.updateDatasetsDetail)
  const updateTime = useRef(0)
  const { getStartNodes } = useWorkflow()

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
    return checkData
  }, [])

  const handleCheckBeforePublish = useCallback(async () => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const nodes = getNodes()
    const filteredNodes = nodes.filter(node => node.type === CUSTOM_NODE)
    const startNodes = getStartNodes(filteredNodes)
    const validNodesFlattened = startNodes.map(startNode => getValidTreeNodes(startNode, filteredNodes, edges))
    const validNodes = validNodesFlattened.reduce((acc, curr) => {
      if (curr.validNodes)
        acc.push(...curr.validNodes)
      return acc
    }, [] as Node[])
    const maxDepthArr = validNodesFlattened.map(item => item.maxDepth)

    for (let i = 0; i < maxDepthArr.length; i++) {
      if (maxDepthArr[i] > MAX_TREE_DEPTH) {
        notify({ type: 'error', message: t('workflow.common.maxTreeDepth', { depth: MAX_TREE_DEPTH }) })
        return false
      }
    }
    // Before publish, we need to fetch datasets detail, in case of the settings of datasets have been changed
    const knowledgeRetrievalNodes = nodes.filter(node => node.data.type === BlockEnum.KnowledgeRetrieval)
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

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      let moreDataForCheckValid
      if (node.data.type === BlockEnum.Tool)
        moreDataForCheckValid = getToolCheckParams(node.data as ToolNodeType, buildInTools, customTools, workflowTools, language)

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

      const checkData = getCheckData(node.data, datasets)
      const { errorMessage } = nodesExtraData![node.data.type as BlockEnum].checkValid(checkData, t, moreDataForCheckValid)

      if (errorMessage) {
        notify({ type: 'error', message: `[${node.data.title}] ${errorMessage}` })
        return false
      }

      if (!validNodes.find(n => n.id === node.id)) {
        notify({ type: 'error', message: `[${node.data.title}] ${t('workflow.common.needConnectTip')}` })
        return false
      }
    }

    const isRequiredNodesType = Object.keys(nodesExtraData!).filter((key: any) => (nodesExtraData as any)[key].metaData.isRequired)

    for(let i = 0; i < isRequiredNodesType.length; i++) {
      const type = isRequiredNodesType[i]
      if (!nodes.find(node => node.data.type === type)) {
        notify({ type: 'error', message: t('workflow.common.needAdd', { node: t(`workflow.blocks.${type}`) }) })
        return false
      }
    }

    return true
  }, [store, notify, t, buildInTools, customTools, workflowTools, language, nodesExtraData, strategyProviders, updateDatasetsDetail, getCheckData, getStartNodes])

  return {
    handleCheckBeforePublish,
  }
}
