import type { AvailableNodesMetaData } from '@/app/components/workflow/hooks-store/store'
import type { HumanInputV2NodeType } from '@/app/components/workflow/nodes/human-input-v2/types'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from 'reactflow'
import { useShallow } from 'zustand/react/shallow'
import { WORKFLOW_COMMON_NODES } from '@/app/components/workflow/constants/node'
import { isChatflowAtom } from '@/app/components/workflow/editor-resource/state'
import AnswerDefault from '@/app/components/workflow/nodes/answer/default'
import EndDefault from '@/app/components/workflow/nodes/end/default'
import { getHumanInputCreationPolicy } from '@/app/components/workflow/nodes/human-input-v2/migration/policy'
import StartPlaceholderDefault from '@/app/components/workflow/nodes/start-placeholder/default'
import StartDefault from '@/app/components/workflow/nodes/start/default'
import TriggerPluginDefault from '@/app/components/workflow/nodes/trigger-plugin/default'
import TriggerScheduleDefault from '@/app/components/workflow/nodes/trigger-schedule/default'
import TriggerWebhookDefault from '@/app/components/workflow/nodes/trigger-webhook/default'
import { useStore as useWorkflowStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { getNodePersistedType } from '@/app/components/workflow/utils/node'
import { ENABLE_HITL_IM } from '@/config'
import { useDocLink } from '@/context/i18n'
import { isAgentV2Enabled, isAgentV2InChatflowEnabled } from '@/features/agent-v2/feature-flag'
import { consoleQuery } from '@/service/console'
import { isProductlessDocPathWithAnchor } from '@/types/doc-paths'

const getNodeHelpLinkPath = (helpLinkUri?: string): DocPathWithoutLang | undefined => {
  if (!helpLinkUri) return undefined

  const helpLinkPath = `/use-dify/nodes/${helpLinkUri}`
  return isProductlessDocPathWithAnchor(helpLinkPath) ? helpLinkPath : undefined
}

export const useWorkflowNodeCatalog = () => {
  const { t } = useTranslation(['workflow'])
  const isChatflow = useAtomValue(isChatflowAtom)
  const humanInputDefaultConfig = useWorkflowStore(
    (state) =>
      state.nodesDefaultConfigs?.[BlockEnum.HumanInput] as
        | Partial<HumanInputV2NodeType>
        | undefined,
  )
  const humanInputV2MessageTemplate =
    humanInputDefaultConfig?.version === '2' ? humanInputDefaultConfig.message_template : undefined
  const docLink = useDocLink()
  const agentV2Enabled = isAgentV2Enabled()
  // Chatflow (advanced-chat) keeps Agent v2 hidden by default; opt in via
  // NEXT_PUBLIC_ENABLE_AGENT_V2_IN_CHATFLOW. Pure workflows are unaffected.
  const shouldUseAgentV2 = agentV2Enabled && (!isChatflow || isAgentV2InChatflowEnabled())
  const { data: knowledgeFsEnabled = false } = useQuery(
    consoleQuery.features.get.queryOptions({
      select: (features) => features.enable_knowledge_fs,
    }),
  )
  // The Decision node ships behind a deployment switch. While it is off the block is
  // not offered for creation, but nodesMap keeps it so existing nodes still render.
  const { data: decisionNodeEnabled = false } = useQuery(
    consoleQuery.features.get.queryOptions({
      select: (features) => features.enable_decision_node,
    }),
  )
  const humanInputData = useStore(
    useShallow((state) =>
      ENABLE_HITL_IM
        ? state
            .getNodes()
            .filter((node) => node.data.type === BlockEnum.HumanInput)
            .map((node) => node.data)
        : [],
    ),
  )
  const canContinueLegacyHumanInput = useMemo(
    () =>
      ENABLE_HITL_IM &&
      getHumanInputCreationPolicy(
        humanInputData.map((data) => ({ data })),
        true,
      ).canAddLegacyHumanInput,
    [humanInputData],
  )
  const useLegacyHumanInput = !ENABLE_HITL_IM || canContinueLegacyHumanInput

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
        const titleKey =
          metaData.type === BlockEnum.HumanInputV2 ? BlockEnum.HumanInput : metaData.type
        const title = t(($) => $[`blocks.${titleKey}`], { ns: 'workflow' })
        const description = t(($) => $[`blocksAbout.${titleKey}`], { ns: 'workflow' })
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
            ...(metaData.type === BlockEnum.HumanInputV2 && humanInputV2MessageTemplate
              ? { message_template: humanInputV2MessageTemplate }
              : {}),
            type: getNodePersistedType(metaData.type),
            title,
          },
        }
      }),
    [mergedNodesMetaData, t, docLink, humanInputV2MessageTemplate],
  )

  const availableNodesMetaData = useMemo(
    () =>
      nodesMetaData.filter(
        (node) =>
          (node.metaData.type !== BlockEnum.HumanInputV2 || !!humanInputV2MessageTemplate) &&
          node.metaData.type !==
            (useLegacyHumanInput ? BlockEnum.HumanInputV2 : BlockEnum.HumanInput) &&
          (shouldUseAgentV2
            ? node.metaData.type !== BlockEnum.Agent
            : node.metaData.type !== BlockEnum.AgentV2) &&
          (decisionNodeEnabled || node.metaData.type !== BlockEnum.Decision),
      ),
    [
      nodesMetaData,
      shouldUseAgentV2,
      useLegacyHumanInput,
      humanInputV2MessageTemplate,
      decisionNodeEnabled,
    ],
  )

  const nodesMetaDataMap = useMemo(
    () =>
      nodesMetaData.reduce(
        (acc, node) => {
          acc![node.metaData.type] = node
          return acc
        },
        {} as unknown as AvailableNodesMetaData['nodesMap'],
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
