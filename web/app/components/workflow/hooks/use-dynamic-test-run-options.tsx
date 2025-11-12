import { useMemo } from 'react'
import { useNodes } from 'reactflow'
import { useTranslation } from 'react-i18next'
import { BlockEnum, type CommonNodeType } from '../types'
import { getWorkflowEntryNode } from '../utils/workflow-entry'
import { type TestRunOptions, type TriggerOption, TriggerType } from '../header/test-run-menu'
import { TriggerAll } from '@/app/components/base/icons/src/vender/workflow'
import BlockIcon from '../block-icon'
import { useStore } from '../store'
import { useAllTriggerPlugins } from '@/service/use-triggers'

export const useDynamicTestRunOptions = (): TestRunOptions => {
  const { t } = useTranslation()
  const nodes = useNodes()
  const buildInTools = useStore(s => s.buildInTools)
  const customTools = useStore(s => s.customTools)
  const workflowTools = useStore(s => s.workflowTools)
  const mcpTools = useStore(s => s.mcpTools)
  const { data: triggerPlugins } = useAllTriggerPlugins()

  return useMemo(() => {
    const allTriggers: TriggerOption[] = []
    let userInput: TriggerOption | undefined

    for (const node of nodes) {
      const nodeData = node.data as CommonNodeType

      if (!nodeData?.type) continue

      if (nodeData.type === BlockEnum.Start) {
        userInput = {
          id: node.id,
          type: TriggerType.UserInput,
          name: nodeData.title || t('workflow.blocks.start'),
          icon: (
            <BlockIcon
              type={BlockEnum.Start}
              size='md'
            />
          ),
          nodeId: node.id,
          enabled: true,
        }
      }
      else if (nodeData.type === BlockEnum.TriggerSchedule) {
        allTriggers.push({
          id: node.id,
          type: TriggerType.Schedule,
          name: nodeData.title || t('workflow.blocks.trigger-schedule'),
          icon: (
            <BlockIcon
              type={BlockEnum.TriggerSchedule}
              size='md'
            />
          ),
          nodeId: node.id,
          enabled: true,
        })
      }
      else if (nodeData.type === BlockEnum.TriggerWebhook) {
        allTriggers.push({
          id: node.id,
          type: TriggerType.Webhook,
          name: nodeData.title || t('workflow.blocks.trigger-webhook'),
          icon: (
            <BlockIcon
              type={BlockEnum.TriggerWebhook}
              size='md'
            />
          ),
          nodeId: node.id,
          enabled: true,
        })
      }
      else if (nodeData.type === BlockEnum.TriggerPlugin) {
        let triggerIcon: string | any

        if (nodeData.provider_id) {
          const targetTriggers = triggerPlugins || []
          triggerIcon = targetTriggers.find(toolWithProvider => toolWithProvider.name === nodeData.provider_id)?.icon
        }

        const icon = (
          <BlockIcon
            type={BlockEnum.TriggerPlugin}
            size='md'
            toolIcon={triggerIcon}
          />
        )

        allTriggers.push({
          id: node.id,
          type: TriggerType.Plugin,
          name: nodeData.title || (nodeData as any).plugin_name || t('workflow.blocks.trigger-plugin'),
          icon,
          nodeId: node.id,
          enabled: true,
        })
      }
    }

    if (!userInput) {
      const startNode = getWorkflowEntryNode(nodes as any[])
      if (startNode && startNode.data?.type === BlockEnum.Start) {
        userInput = {
          id: startNode.id,
          type: TriggerType.UserInput,
          name: (startNode.data as CommonNodeType)?.title || t('workflow.blocks.start'),
          icon: (
            <BlockIcon
              type={BlockEnum.Start}
              size='md'
            />
          ),
          nodeId: startNode.id,
          enabled: true,
        }
      }
    }

    const triggerNodeIds = allTriggers
      .map(trigger => trigger.nodeId)
      .filter((nodeId): nodeId is string => Boolean(nodeId))

    const runAll: TriggerOption | undefined = triggerNodeIds.length > 1 ? {
      id: 'run-all',
      type: TriggerType.All,
      name: t('workflow.common.runAllTriggers'),
      icon: (
        <div className="flex h-6 w-6 items-center justify-center rounded-lg border-[0.5px] border-white/2 bg-util-colors-purple-purple-500 text-white shadow-md">
          <TriggerAll className="h-4.5 w-4.5" />
        </div>
      ),
      relatedNodeIds: triggerNodeIds,
      enabled: true,
    } : undefined

    return {
      userInput,
      triggers: allTriggers,
      runAll,
    }
  }, [nodes, buildInTools, customTools, workflowTools, mcpTools, triggerPlugins, t])
}
