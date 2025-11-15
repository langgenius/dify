import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import StartDefault from '@/app/components/workflow/nodes/start/default'
import TriggerWebhookDefault from '@/app/components/workflow/nodes/trigger-webhook/default'
import TriggerScheduleDefault from '@/app/components/workflow/nodes/trigger-schedule/default'
import TriggerPluginDefault from '@/app/components/workflow/nodes/trigger-plugin/default'
import EndDefault from '@/app/components/workflow/nodes/end/default'
import AnswerDefault from '@/app/components/workflow/nodes/answer/default'
import { WORKFLOW_COMMON_NODES } from '@/app/components/workflow/constants/node'
import type { AvailableNodesMetaData } from '@/app/components/workflow/hooks-store/store'
import { useIsChatMode } from './use-is-chat-mode'
import { BlockEnum } from '@/app/components/workflow/types'

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
  ], [isChatMode, startNodeMetaData])

  const availableNodesMetaData = useMemo(() => mergedNodesMetaData.map((node) => {
    const { metaData } = node
    const title = t(`workflow.blocks.${metaData.type}`)
    const description = t(`workflow.blocksAbout.${metaData.type}`)
    const helpLinkPath = `guides/workflow/node/${metaData.helpLinkUri}`
    return {
      ...node,
      metaData: {
        ...metaData,
        title,
        description,
        helpLinkUri: docLink(helpLinkPath),
      },
      defaultValue: {
        ...node.defaultValue,
        type: metaData.type,
        title,
      },
    }
  }), [mergedNodesMetaData, t, docLink])

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
