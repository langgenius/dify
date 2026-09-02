import type { AvailableNodesMetaData } from '@/app/components/workflow/hooks-store/store'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import type { I18nKeysWithPrefix } from '@/types/i18n'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { WORKFLOW_COMMON_NODES } from '@/app/components/workflow/constants/node'
import AnswerDefault from '@/app/components/workflow/nodes/answer/default'
import EndDefault from '@/app/components/workflow/nodes/end/default'
import StartPlaceholderDefault from '@/app/components/workflow/nodes/start-placeholder/default'
import StartDefault from '@/app/components/workflow/nodes/start/default'
import TriggerPluginDefault from '@/app/components/workflow/nodes/trigger-plugin/default'
import TriggerScheduleDefault from '@/app/components/workflow/nodes/trigger-schedule/default'
import TriggerWebhookDefault from '@/app/components/workflow/nodes/trigger-webhook/default'
import { BlockEnum } from '@/app/components/workflow/types'
import { useDocLink } from '@/context/i18n'
import { isAgentV2Enabled } from '@/features/agent-v2/feature-flag'
import { knowledgeFsEnabledAtom } from '@/features/system-features/state'
import { isProductlessDocPathWithAnchor } from '@/types/doc-paths'
import { useIsChatMode } from './use-is-chat-mode'

const getNodeHelpLinkPath = (helpLinkUri?: string): DocPathWithoutLang | undefined => {
  if (!helpLinkUri) return undefined

  const helpLinkPath = `/use-dify/nodes/${helpLinkUri}`
  return isProductlessDocPathWithAnchor(helpLinkPath) ? helpLinkPath : undefined
}

export const useAvailableNodesMetaData = () => {
  const { t } = useTranslation()
  const isChatMode = useIsChatMode()
  const docLink = useDocLink()
  const agentV2Enabled = isAgentV2Enabled()
  const knowledgeFsEnabled = useAtomValue(knowledgeFsEnabledAtom)
  const shouldUseAgentV2 = agentV2Enabled && !isChatMode

  const startNodeMetaData = useMemo(
    () => ({
      ...StartDefault,
      metaData: {
        ...StartDefault.metaData,
        isUndeletable: isChatMode, // start node is undeletable in chat mode, @use-nodes-interactions: handleNodeDelete function
      },
    }),
    [isChatMode],
  )

  const mergedNodesMetaData = useMemo(() => {
    const commonNodes = WORKFLOW_COMMON_NODES.filter(
      (node) => knowledgeFsEnabled || node.metaData.type !== BlockEnum.KnowledgeRetrievalV2,
    )

    return [
      ...commonNodes,
      startNodeMetaData,
      ...(isChatMode
        ? [AnswerDefault]
        : [
            StartPlaceholderDefault,
            EndDefault,
            TriggerWebhookDefault,
            TriggerScheduleDefault,
            TriggerPluginDefault,
          ]),
    ]
  }, [isChatMode, knowledgeFsEnabled, startNodeMetaData])

  const nodesMetaData = useMemo(
    () =>
      mergedNodesMetaData.map((node) => {
        const { metaData } = node
        const title = t(($) => $[`blocks.${metaData.type}`], { ns: 'workflow' })
        const description = t(
          ($) =>
            $[`blocksAbout.${metaData.type}` as I18nKeysWithPrefix<'workflow', 'blocksAbout.'>],
          { ns: 'workflow' },
        )
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

  return useMemo(() => {
    return {
      nodes: availableNodesMetaData,
      nodesMap: {
        ...nodesMetaDataMap,
        [BlockEnum.VariableAssigner]: nodesMetaDataMap?.[BlockEnum.VariableAggregator],
      },
    }
  }, [availableNodesMetaData, nodesMetaDataMap])
}
