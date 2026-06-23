import type { FC } from 'react'
import type { StartPlaceholderNodeType } from './types'
import type {
  PluginDefaultValue,
  TriggerDefaultValue,
} from '@/app/components/workflow/block-selector/types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import * as React from 'react'
import {
  useCallback,
  useState,
} from 'react'
import { useTranslation } from '#i18n'
import { useStoreApi } from 'reactflow'
import SearchBox from '@/app/components/plugins/marketplace/search-box'
import AllStartBlocks from '@/app/components/workflow/block-selector/all-start-blocks'
import { useAutoGenerateWebhookUrl } from '@/app/components/workflow/hooks'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import { useStore as useWorkflowStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'

const getTriggerPluginNodeData = (
  triggerConfig: TriggerDefaultValue,
  fallbackTitle?: string,
  fallbackDesc?: string,
) => {
  return {
    plugin_id: triggerConfig.plugin_id,
    provider_id: triggerConfig.provider_name,
    provider_type: triggerConfig.provider_type,
    provider_name: triggerConfig.provider_name,
    event_name: triggerConfig.event_name,
    event_label: triggerConfig.event_label,
    event_description: triggerConfig.event_description,
    title: triggerConfig.event_label || triggerConfig.title || fallbackTitle,
    desc: triggerConfig.event_description || fallbackDesc,
    output_schema: { ...triggerConfig.output_schema },
    parameters_schema: triggerConfig.paramSchemas ? [...triggerConfig.paramSchemas] : [],
    config: { ...triggerConfig.params },
    subscription_id: triggerConfig.subscription_id,
    plugin_unique_identifier: triggerConfig.plugin_unique_identifier,
    is_team_authorization: triggerConfig.is_team_authorization,
    meta: triggerConfig.meta ? { ...triggerConfig.meta } : undefined,
  }
}

const Panel: FC<NodePanelProps<StartPlaceholderNodeType>> = ({
  id,
}) => {
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const availableNodesMetaData = useHooksStore(s => s.availableNodesMetaData)
  const setHasSelectedStartNode = useWorkflowStore(s => s.setHasSelectedStartNode)
  const setShouldAutoOpenStartNodeSelector = useWorkflowStore(s => s.setShouldAutoOpenStartNodeSelector)
  const reactFlowStore = useStoreApi()
  const autoGenerateWebhookUrl = useAutoGenerateWebhookUrl()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()

  const handleSelectStartNode = useCallback((nodeType: BlockEnum, toolConfig?: PluginDefaultValue) => {
    const nodeDefault = availableNodesMetaData?.nodesMap?.[nodeType]
    if (!nodeDefault?.defaultValue)
      return

    const baseNodeData = { ...nodeDefault.defaultValue }
    const mergedNodeData = (() => {
      if (nodeType !== BlockEnum.TriggerPlugin || !toolConfig) {
        return {
          ...baseNodeData,
          ...toolConfig,
        }
      }

      const triggerNodeData = getTriggerPluginNodeData(
        toolConfig as TriggerDefaultValue,
        baseNodeData.title,
        baseNodeData.desc,
      )

      return {
        ...baseNodeData,
        ...triggerNodeData,
        config: {
          ...(baseNodeData as { config?: Record<string, unknown> }).config,
          ...triggerNodeData.config,
        },
      }
    })()

    const { getNodes, setNodes } = reactFlowStore.getState()
    const nextNodes = getNodes().map((node) => {
      if (node.id !== id) {
        return {
          ...node,
          data: {
            ...node.data,
            selected: false,
          },
        }
      }

      return {
        ...node,
        data: {
          ...mergedNodeData,
          type: nodeType,
          selected: true,
        },
      }
    })

    setNodes(nextNodes)
    setHasSelectedStartNode?.(true)
    setShouldAutoOpenStartNodeSelector?.(true)

    handleSyncWorkflowDraft(true, false, {
      onSuccess: () => {
        autoGenerateWebhookUrl(id)
      },
      onError: () => {
        console.error('Failed to save start node selection to draft')
      },
    })
  }, [
    autoGenerateWebhookUrl,
    availableNodesMetaData?.nodesMap,
    handleSyncWorkflowDraft,
    id,
    reactFlowStore,
    setHasSelectedStartNode,
    setShouldAutoOpenStartNodeSelector,
  ])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-3 py-2">
        <SearchBox
          search={searchText}
          onSearchChange={setSearchText}
          tags={tags}
          onTagsChange={setTags}
          placeholder={t('tabs.searchTrigger', { ns: 'workflow' })}
          inputClassName="grow"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <AllStartBlocks
          className="max-w-none min-w-0"
          searchText={searchText}
          onSelect={handleSelectStartNode}
          availableBlocksTypes={[
            BlockEnum.Start,
            BlockEnum.TriggerSchedule,
            BlockEnum.TriggerWebhook,
            BlockEnum.TriggerPlugin,
          ]}
          tags={tags}
          allowUserInputSelection
          variant="panel"
        />
      </div>
    </div>
  )
}

export default React.memo(Panel)
