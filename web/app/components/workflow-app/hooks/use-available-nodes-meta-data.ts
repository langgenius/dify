import type { AvailableNodesMetaData } from '@/app/components/workflow/hooks-store/store'
import type { CommonNodeType, NodeDefault, NodeDefaultBase } from '@/app/components/workflow/types'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { WORKFLOW_COMMON_NODES } from '@/app/components/workflow/constants/node'
import AnswerDefault from '@/app/components/workflow/nodes/answer/default'
import EndDefault from '@/app/components/workflow/nodes/end/default'
import StartDefault from '@/app/components/workflow/nodes/start/default'
import TriggerPluginDefault from '@/app/components/workflow/nodes/trigger-plugin/default'
import TriggerScheduleDefault from '@/app/components/workflow/nodes/trigger-schedule/default'
import TriggerWebhookDefault from '@/app/components/workflow/nodes/trigger-webhook/default'
import { BlockEnum } from '@/app/components/workflow/types'
import { useDocLink } from '@/context/i18n'
import { useIsChatMode } from './use-is-chat-mode'

export const useAvailableNodesMetaData = () => {
  const { t } = useTranslation()
  const isChatMode = useIsChatMode()
  const docLink = useDocLink()

  const startNodeMetaData = useMemo(() => ({
    ...StartDefault,
    metaData: {
      ...StartDefault.metaData,
      isUndeletable: isChatMode, // start node is undeletable in chat mode, @use-nodes-interactions: handleNodeDelete function
    },
  }), [isChatMode])

  const mergedNodesMetaData = useMemo(() => [
    ...WORKFLOW_COMMON_NODES,
    startNodeMetaData,
    ...(
      isChatMode
        ? [AnswerDefault]
        : [
            EndDefault,
            TriggerWebhookDefault,
            TriggerScheduleDefault,
            TriggerPluginDefault,
          ]
    ),
  ] as AvailableNodesMetaData['nodes'], [isChatMode, startNodeMetaData])

  const availableNodesMetaData = useMemo<NodeDefaultBase[]>(() => {
    const toNodeDefaultBase = (
      node: NodeDefault<CommonNodeType>,
      metaData: NodeDefaultBase['metaData'],
      defaultValue: Partial<CommonNodeType>,
    ): NodeDefaultBase => {
      return {
        ...node,
        metaData,
        defaultValue,
        checkValid: (payload: CommonNodeType, translator, moreDataForCheckValid) => {
          // normalize validator signature for shared metadata storage.
          return node.checkValid(payload, translator, moreDataForCheckValid)
        },
        getOutputVars: node.getOutputVars
          ? (payload: CommonNodeType, allPluginInfoList, ragVariables, utils) => {
              // normalize output var signature for shared metadata storage.
              return node.getOutputVars!(payload, allPluginInfoList, ragVariables, utils)
            }
          : undefined,
      }
    }

    return mergedNodesMetaData.map((node) => {
      // normalize per-node defaults into a shared metadata shape.
      const typedNode = node as NodeDefault<CommonNodeType>
      const { metaData } = typedNode
      const title = t(`blocks.${metaData.type}`, { ns: 'workflow' })
      const description = t(`blocksAbout.${metaData.type}`, { ns: 'workflow' })
      const helpLinkPath = `/use-dify/nodes/${metaData.helpLinkUri}` as DocPathWithoutLang
      return toNodeDefaultBase(typedNode, {
        ...metaData,
        title,
        description,
        helpLinkUri: docLink(helpLinkPath),
      }, {
        ...typedNode.defaultValue,
        type: metaData.type,
        title,
      })
    })
  }, [mergedNodesMetaData, t, docLink])

  const availableNodesMetaDataMap = useMemo(() => availableNodesMetaData.reduce((acc, node) => {
    acc![node.metaData.type] = node
    return acc
  }, {} as AvailableNodesMetaData['nodesMap']), [availableNodesMetaData])

  return useMemo(() => {
    return {
      nodes: availableNodesMetaData,
      nodesMap: {
        ...availableNodesMetaDataMap,
        [BlockEnum.VariableAssigner]: availableNodesMetaDataMap?.[BlockEnum.VariableAggregator],
      },
    }
  }, [availableNodesMetaData, availableNodesMetaDataMap])
}
