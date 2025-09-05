import { useMemo } from 'react'
import { useNodes } from 'reactflow'
import { useTranslation } from 'react-i18next'
import { BlockEnum, type CommonNodeType } from '../types'
import { getWorkflowEntryNode } from '../utils/workflow-entry'
import type { TestRunOptions, TriggerOption } from '../header/test-run-dropdown'
import Home from '@/app/components/base/icons/src/vender/workflow/Home'
import { Schedule, TriggerAll, WebhookLine } from '@/app/components/base/icons/src/vender/workflow'
import AppIcon from '@/app/components/base/app-icon'
import { useStore } from '../store'
import { canFindTool } from '@/utils'
import { CollectionType } from '@/app/components/tools/types'
import useGetIcon from '@/app/components/plugins/install-plugin/base/use-get-icon'

export const useDynamicTestRunOptions = (): TestRunOptions => {
  const { t } = useTranslation()
  const nodes = useNodes()
  const buildInTools = useStore(s => s.buildInTools)
  const customTools = useStore(s => s.customTools)
  const workflowTools = useStore(s => s.workflowTools)
  const mcpTools = useStore(s => s.mcpTools)
  const { getIconUrl } = useGetIcon()

  return useMemo(() => {
    const allTriggers: TriggerOption[] = []
    let userInput: TriggerOption | undefined

    for (const node of nodes) {
      const nodeData = node.data as CommonNodeType

      if (!nodeData?.type) continue

      if (nodeData.type === BlockEnum.Start) {
        userInput = {
          id: node.id,
          type: 'user_input',
          name: nodeData.title || t('workflow.blocks.start'),
          icon: (
            <div className="flex h-6 w-6 items-center justify-center rounded-lg border-[0.5px] border-white/2 bg-util-colors-blue-brand-blue-brand-500 text-white shadow-md">
              <Home className="h-3.5 w-3.5" />
            </div>
          ),
          nodeId: node.id,
          enabled: true,
        }
      }
      else if (nodeData.type === BlockEnum.TriggerSchedule) {
        allTriggers.push({
          id: node.id,
          type: 'schedule',
          name: nodeData.title || t('workflow.blocks.trigger-schedule'),
          icon: (
            <div className="flex h-6 w-6 items-center justify-center rounded-lg border-[0.5px] border-white/2 bg-util-colors-violet-violet-500 text-white shadow-md">
              <Schedule className="h-4.5 w-4.5" />
            </div>
          ),
          nodeId: node.id,
          enabled: true,
        })
      }
      else if (nodeData.type === BlockEnum.TriggerWebhook) {
        allTriggers.push({
          id: node.id,
          type: 'webhook',
          name: nodeData.title || t('workflow.blocks.trigger-webhook'),
          icon: (
            <div className="flex h-6 w-6 items-center justify-center rounded-lg border-[0.5px] border-white/2 bg-util-colors-blue-blue-500 text-white shadow-md">
              <WebhookLine className="h-4.5 w-4.5" />
            </div>
          ),
          nodeId: node.id,
          enabled: true,
        })
      }
      else if (nodeData.type === BlockEnum.TriggerPlugin) {
        let icon
        let toolIcon: string | any

        // 按照 use-workflow-search.tsx 的模式获取工具图标
        if (nodeData.provider_id) {
          let targetTools = workflowTools
          if (nodeData.provider_type === CollectionType.builtIn)
            targetTools = buildInTools
          else if (nodeData.provider_type === CollectionType.custom)
            targetTools = customTools
          else if (nodeData.provider_type === CollectionType.mcp)
            targetTools = mcpTools

          toolIcon = targetTools.find(toolWithProvider => canFindTool(toolWithProvider.id, nodeData.provider_id!))?.icon
        }

        if (typeof toolIcon === 'string') {
          const iconUrl = toolIcon.startsWith('http') ? toolIcon : getIconUrl(toolIcon)
          icon = (
            <div
              className="bg-util-colors-white-white-500 flex h-6 w-6 items-center justify-center rounded-lg border-[0.5px] border-white/2 text-white shadow-md"
              style={{
                backgroundImage: `url(${iconUrl})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            />
          )
        }
        else if (toolIcon && typeof toolIcon === 'object' && 'content' in toolIcon) {
          icon = (
            <AppIcon
              className="!h-6 !w-6 rounded-lg border-[0.5px] border-white/2 shadow-md"
              size="tiny"
              icon={toolIcon.content}
              background={toolIcon.background}
            />
          )
        }
        else {
          icon = (
            <div className="bg-util-colors-white-white-500 flex h-6 w-6 items-center justify-center rounded-lg border-[0.5px] border-white/2 text-white shadow-md">
              <span className="text-xs font-medium text-text-tertiary">P</span>
            </div>
          )
        }

        allTriggers.push({
          id: node.id,
          type: 'plugin',
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
          type: 'user_input',
          name: (startNode.data as CommonNodeType)?.title || t('workflow.blocks.start'),
          icon: (
            <div className="flex h-6 w-6 items-center justify-center rounded-lg border-[0.5px] border-white/2 bg-util-colors-blue-brand-blue-brand-500 text-white shadow-md">
              <Home className="h-3.5 w-3.5" />
            </div>
          ),
          nodeId: startNode.id,
          enabled: true,
        }
      }
    }

    const runAll: TriggerOption | undefined = allTriggers.length > 1 ? {
      id: 'run-all',
      type: 'all',
      name: t('workflow.common.runAllTriggers'),
      icon: (
        <div className="flex h-6 w-6 items-center justify-center rounded-lg border-[0.5px] border-white/2 bg-util-colors-purple-purple-500 text-white shadow-md">
          <TriggerAll className="h-4.5 w-4.5" />
        </div>
      ),
      enabled: true,
    } : undefined

    return {
      userInput,
      triggers: allTriggers,
      runAll,
    }
  }, [nodes, buildInTools, customTools, workflowTools, mcpTools, getIconUrl, t])
}
