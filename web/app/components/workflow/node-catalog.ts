import type { AvailableNodesMetaData } from '@/app/components/workflow/hooks-store/store'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { WORKFLOW_COMMON_NODES } from '@/app/components/workflow/constants/node'
import { isChatflowAtom } from '@/app/components/workflow/editor-resource/state'
import AnswerDefault from '@/app/components/workflow/nodes/answer/default'
import EndDefault from '@/app/components/workflow/nodes/end/default'
import StartPlaceholderDefault from '@/app/components/workflow/nodes/start-placeholder/default'
import StartDefault from '@/app/components/workflow/nodes/start/default'
import TriggerPluginDefault from '@/app/components/workflow/nodes/trigger-plugin/default'
import TriggerScheduleDefault from '@/app/components/workflow/nodes/trigger-schedule/default'
import TriggerWebhookDefault from '@/app/components/workflow/nodes/trigger-webhook/default'
import { BlockEnum } from '@/app/components/workflow/types'
import { useDocLink } from '@/context/i18n'
import { isAgentV2Enabled, isAgentV2InChatflowEnabled } from '@/features/agent-v2/feature-flag'
import { knowledgeFsEnabledAtom } from '@/features/knowledge-fs-availability/state'
import { isProductlessDocPathWithAnchor } from '@/types/doc-paths'

const getNodeHelpLinkPath = (helpLinkUri?: string): DocPathWithoutLang | undefined => {
  if (!helpLinkUri) return undefined

  const helpLinkPath = `/use-dify/nodes/${helpLinkUri}`
  return isProductlessDocPathWithAnchor(helpLinkPath) ? helpLinkPath : undefined
}

export const useWorkflowNodeCatalog = () => {
  const { t } = useTranslation(['workflow'])
  const isChatflow = useAtomValue(isChatflowAtom)
  const docLink = useDocLink()
  const agentV2Enabled = isAgentV2Enabled()
  // Chatflow (advanced-chat) keeps Agent v2 hidden by default; opt in via
  // NEXT_PUBLIC_ENABLE_AGENT_V2_IN_CHATFLOW. Pure workflows are unaffected.
  const shouldUseAgentV2 = agentV2Enabled && (!isChatflow || isAgentV2InChatflowEnabled())
  const knowledgeFsEnabled = useAtomValue(knowledgeFsEnabledAtom)

  const startNodeMetaData = useMemo(
    () => ({
      ...StartDefault,
      metaData: {
        ...StartDefault.metaData,
        isUndeletable: isChatflow, // start node is undeletable in chat mode, @use-nodes-interactions: handleNodeDelete function
      },
    }),
    [isChatflow],
  )

  const mergedNodesMetaData = useMemo(() => {
    const commonNodes = WORKFLOW_COMMON_NODES.filter(
      (node) => knowledgeFsEnabled || node.metaData.type !== BlockEnum.KnowledgeRetrievalV2,
    )

    return [
      ...commonNodes,
      startNodeMetaData,
      ...(isChatflow
        ? [AnswerDefault]
        : [
            StartPlaceholderDefault,
            EndDefault,
            TriggerWebhookDefault,
            TriggerScheduleDefault,
            TriggerPluginDefault,
          ]),
    ]
  }, [isChatflow, knowledgeFsEnabled, startNodeMetaData])

  const nodesMetaData = useMemo(
    () =>
      mergedNodesMetaData.map((node) => {
        const { metaData } = node
        const title = t(($) => $[`blocks.${metaData.type}`], { ns: 'workflow' })
        const description = t(($) => $[`blocksAbout.${metaData.type}`], { ns: 'workflow' })
        const helpLinkPath = getNodeHelpLinkPath(metaData.helpLinkUri)
        return {
          ...node,
          metaData: {
            ...metaData,
            title,
            description,
            helpLinkUri: helpLinkPath ? docLink(helpLinkPath) : undefined,
          },
          defaultValue: {
            ...node.defaultValue,
            type: metaData.type === BlockEnum.AgentV2 ? BlockEnum.Agent : metaData.type,
            title,
          },
        }
      }),
    [mergedNodesMetaData, t, docLink],
  )

  const availableNodesMetaData = useMemo(
    () =>
      nodesMetaData.filter((node) =>
        shouldUseAgentV2
          ? node.metaData.type !== BlockEnum.Agent
          : node.metaData.type !== BlockEnum.AgentV2,
      ),
    [nodesMetaData, shouldUseAgentV2],
  )

  const nodesMetaDataMap = useMemo(
    () =>
      nodesMetaData.reduce(
        (acc, node) => {
          acc![node.metaData.type] = node
          return acc
        },
        {} as AvailableNodesMetaData['nodesMap'],
      ),
    [nodesMetaData],
  )

  return useMemo(
    () => ({
      nodes: availableNodesMetaData,
      nodesMap: {
        ...nodesMetaDataMap,
        [BlockEnum.VariableAssigner]: nodesMetaDataMap?.[BlockEnum.VariableAggregator],
      },
    }),
    [availableNodesMetaData, nodesMetaDataMap],
  )
}
