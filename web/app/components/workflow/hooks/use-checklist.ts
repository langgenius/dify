import {
  useCallback,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import type {
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
import type { ToolNodeType } from '../nodes/tool/types'
import { useIsChatMode } from './use-workflow'
import { useNodesExtraData } from './use-nodes-data'
import { useToastContext } from '@/app/components/base/toast'
import { CollectionType } from '@/app/components/tools/types'
import { useGetLanguage } from '@/context/i18n'

export const useChecklist = (nodes: Node[], edges: Edge[]) => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const nodesExtraData = useNodesExtraData()
  const isChatMode = useIsChatMode()
  const buildInTools = useStore(s => s.buildInTools)
  const customTools = useStore(s => s.customTools)
  const workflowTools = useStore(s => s.workflowTools)

  const needWarningNodes = useMemo(() => {
    const list = []
    const { validNodes } = getValidTreeNodes(nodes.filter(node => node.type === CUSTOM_NODE), edges)

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      let toolIcon
      let moreDataForCheckValid

      if (node.data.type === BlockEnum.Tool) {
        const { provider_type } = node.data

        moreDataForCheckValid = getToolCheckParams(node.data as ToolNodeType, buildInTools, customTools, workflowTools, language)
        if (provider_type === CollectionType.builtIn)
          toolIcon = buildInTools.find(tool => tool.id === node.data.provider_id)?.icon

        if (provider_type === CollectionType.custom)
          toolIcon = customTools.find(tool => tool.id === node.data.provider_id)?.icon

        if (provider_type === CollectionType.workflow)
          toolIcon = workflowTools.find(tool => tool.id === node.data.provider_id)?.icon
      }

      if (node.type === CUSTOM_NODE) {
        const { errorMessage } = nodesExtraData[node.data.type].checkValid(node.data, t, moreDataForCheckValid)

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

    if (isChatMode && !nodes.find(node => node.data.type === BlockEnum.Answer)) {
      list.push({
        id: 'answer-need-added',
        type: BlockEnum.Answer,
        title: t('workflow.blocks.answer'),
        errorMessage: t('workflow.common.needAnswerNode'),
      })
    }

    if (!isChatMode && !nodes.find(node => node.data.type === BlockEnum.End)) {
      list.push({
        id: 'end-need-added',
        type: BlockEnum.End,
        title: t('workflow.blocks.end'),
        errorMessage: t('workflow.common.needEndNode'),
      })
    }

    return list
  }, [t, nodes, edges, nodesExtraData, buildInTools, customTools, workflowTools, language, isChatMode])

  return needWarningNodes
}

export const useChecklistBeforePublish = () => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const buildInTools = useStore(s => s.buildInTools)
  const customTools = useStore(s => s.customTools)
  const workflowTools = useStore(s => s.workflowTools)
  const { notify } = useToastContext()
  const isChatMode = useIsChatMode()
  const store = useStoreApi()
  const nodesExtraData = useNodesExtraData()

  const handleCheckBeforePublish = useCallback(() => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const nodes = getNodes().filter(node => node.type === CUSTOM_NODE)
    const {
      validNodes,
      maxDepth,
    } = getValidTreeNodes(nodes.filter(node => node.type === CUSTOM_NODE), edges)

    if (maxDepth > MAX_TREE_DEPTH) {
      notify({ type: 'error', message: t('workflow.common.maxTreeDepth', { depth: MAX_TREE_DEPTH }) })
      return false
    }

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      let moreDataForCheckValid
      if (node.data.type === BlockEnum.Tool)
        moreDataForCheckValid = getToolCheckParams(node.data as ToolNodeType, buildInTools, customTools, workflowTools, language)

      const { errorMessage } = nodesExtraData[node.data.type as BlockEnum].checkValid(node.data, t, moreDataForCheckValid)

      if (errorMessage) {
        notify({ type: 'error', message: `[${node.data.title}] ${errorMessage}` })
        return false
      }

      if (!validNodes.find(n => n.id === node.id)) {
        notify({ type: 'error', message: `[${node.data.title}] ${t('workflow.common.needConnectTip')}` })
        return false
      }
    }

    if (isChatMode && !nodes.find(node => node.data.type === BlockEnum.Answer)) {
      notify({ type: 'error', message: t('workflow.common.needAnswerNode') })
      return false
    }

    if (!isChatMode && !nodes.find(node => node.data.type === BlockEnum.End)) {
      notify({ type: 'error', message: t('workflow.common.needEndNode') })
      return false
    }

    return true
  }, [nodesExtraData, notify, t, store, isChatMode, buildInTools, customTools, workflowTools, language])

  return {
    handleCheckBeforePublish,
  }
}
