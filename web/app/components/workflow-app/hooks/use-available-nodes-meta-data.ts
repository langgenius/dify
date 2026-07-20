import type { AvailableNodesMetaData } from '@/app/components/workflow/hooks-store/store'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import type { I18nKeysWithPrefix } from '@/types/i18n'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { WORKFLOW_COMMON_NODES } from '@/app/components/workflow/constants/node'
import AnswerDefault from '@/app/components/workflow/nodes/answer/default'
import EndDefault from '@/app/components/workflow/nodes/end/default'
import HumanInputDefault from '@/app/components/workflow/nodes/human-input/default'
import StartPlaceholderDefault from '@/app/components/workflow/nodes/start-placeholder/default'
import StartDefault from '@/app/components/workflow/nodes/start/default'
import TriggerPluginDefault from '@/app/components/workflow/nodes/trigger-plugin/default'
import TriggerScheduleDefault from '@/app/components/workflow/nodes/trigger-schedule/default'
import TriggerWebhookDefault from '@/app/components/workflow/nodes/trigger-webhook/default'
import { BlockEnum } from '@/app/components/workflow/types'
import { getNodePersistedType } from '@/app/components/workflow/utils/node'
import { useDocLink } from '@/context/i18n'
import { isAgentV2Enabled } from '@/features/agent-v2/feature-flag'
import { docPathProductAvailability } from '@/types/doc-paths'
import { useIsChatMode } from './use-is-chat-mode'

const getNodeHelpLinkPath = (helpLinkUri?: string): DocPathWithoutLang | undefined => {
  if (!helpLinkUri) return undefined

  const helpLinkPath = `/use-dify/nodes/${helpLinkUri}`
  if (!docPathProductAvailability[helpLinkPath]) return undefined

  return helpLinkPath as DocPathWithoutLang
}

export const useAvailableNodesMetaData = () => {
  const { t } = useTranslation()
  const isChatMode = useIsChatMode()
  const docLink = useDocLink()
  const agentV2Enabled = isAgentV2Enabled()

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
    const commonNodes = WORKFLOW_COMMON_NODES.filter((node) => {
      if (node.metaData.type === BlockEnum.HumanInput) return false
      return agentV2Enabled
        ? node.metaData.type !== BlockEnum.Agent
        : node.metaData.type !== BlockEnum.AgentV2
    })

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
  }, [agentV2Enabled, isChatMode, startNodeMetaData])

  const availableNodesMetaData = useMemo(() => {
    const localizeNode = (node: (typeof mergedNodesMetaData)[number]) => {
      const { metaData } = node
      const titleKey =
        metaData.type === BlockEnum.HumanInputV2 ? BlockEnum.HumanInput : metaData.type
      const title = t(($) => $[`blocks.${titleKey}`], { ns: 'workflow' })
      const description = t(
        ($) => $[`blocksAbout.${titleKey}` as I18nKeysWithPrefix<'workflow', 'blocksAbout.'>],
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
          type: getNodePersistedType(metaData.type),
          title,
        },
      }
    }

    return mergedNodesMetaData.map(localizeNode)
  }, [mergedNodesMetaData, t, docLink])

  const legacyHumanInputMetaData = useMemo(() => {
    const { metaData } = HumanInputDefault
    const title = t(($) => $[`blocks.${BlockEnum.HumanInput}`], { ns: 'workflow' })
    const description = t(($) => $[`blocksAbout.${BlockEnum.HumanInput}`], { ns: 'workflow' })

    return {
      ...HumanInputDefault,
      metaData: { ...metaData, title, description },
      defaultValue: {
        ...HumanInputDefault.defaultValue,
        type: BlockEnum.HumanInput,
        title,
      },
    }
  }, [t])

  const availableNodesMetaDataMap = useMemo(
    () =>
      availableNodesMetaData.reduce(
        (acc, node) => {
          acc![node.metaData.type] = node
          return acc
        },
        {
          [BlockEnum.HumanInput]: legacyHumanInputMetaData,
        } as unknown as AvailableNodesMetaData['nodesMap'],
      ),
    [availableNodesMetaData, legacyHumanInputMetaData],
  )

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
