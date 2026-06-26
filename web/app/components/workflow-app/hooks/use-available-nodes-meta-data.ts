import type { AvailableNodesMetaData } from '@/app/components/workflow/hooks-store/store'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import type { I18nKeysWithPrefix } from '@/types/i18n'
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
import { useIsChatMode } from './use-is-chat-mode'

export const useAvailableNodesMetaData = () => {
  const { t } = useTranslation()
  const isChatMode = useIsChatMode()
  const docLink = useDocLink()
  const agentV2Enabled = isAgentV2Enabled()

  const startNodeMetaData = useMemo(() => ({
    ...StartDefault,
    metaData: {
      ...StartDefault.metaData,
      isUndeletable: isChatMode, // start node is undeletable in chat mode, @use-nodes-interactions: handleNodeDelete function
    },
  }), [isChatMode])

  const mergedNodesMetaData = useMemo(() => {
    const commonNodes = WORKFLOW_COMMON_NODES.filter(node =>
      agentV2Enabled
        ? node.metaData.type !== BlockEnum.Agent
        : node.metaData.type !== BlockEnum.AgentV2)

    return [
      ...commonNodes,
      startNodeMetaData,
      ...(
        isChatMode
          ? [AnswerDefault]
          : [
              StartPlaceholderDefault,
              EndDefault,
              TriggerWebhookDefault,
              TriggerScheduleDefault,
              TriggerPluginDefault,
            ]
      ),
    ]
  }, [agentV2Enabled, isChatMode, startNodeMetaData])

  const availableNodesMetaData = useMemo(() => mergedNodesMetaData.map((node) => {
    const { metaData } = node
    const title = t(`blocks.${metaData.type}`, { ns: 'workflow' })
    const description = t(`blocksAbout.${metaData.type}` as I18nKeysWithPrefix<'workflow', 'blocksAbout.'>, { ns: 'workflow' })
    const helpLinkPath = `/use-dify/nodes/${metaData.helpLinkUri}` as DocPathWithoutLang
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
        type: metaData.type === BlockEnum.AgentV2 ? BlockEnum.Agent : metaData.type,
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
