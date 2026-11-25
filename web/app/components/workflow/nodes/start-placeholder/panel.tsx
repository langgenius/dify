import type { FC } from 'react'
import type { PluginDefaultValue } from '@/app/components/workflow/block-selector/types'
import type { CommonNodeType, NodePanelProps } from '@/app/components/workflow/types'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PluginSearchInput } from '@/app/components/plugins/plugin-search-input'
import AllStartBlocks from '@/app/components/workflow/block-selector/all-start-blocks'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { useStore as useWorkflowStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { getStartNodeData, useSelectStartNode } from '../../hooks/use-select-start-node'

const Panel: FC<NodePanelProps<CommonNodeType>> = ({ id }) => {
  const { t } = useTranslation(['workflow'])
  const [searchText, setSearchText] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const availableNodesMetaData = useHooksStore((s) => s.availableNodesMetaData)
  const setHasSelectedStartNode = useWorkflowStore((s) => s.setHasSelectedStartNode)
  const setShouldAutoOpenStartNodeSelector = useWorkflowStore(
    (s) => s.setShouldAutoOpenStartNodeSelector,
  )
  const selectStartNode = useSelectStartNode()

  const handleSelectStartNode = useCallback(
    (nodeType: BlockEnum, toolConfig?: PluginDefaultValue) => {
      const nodeDefault = availableNodesMetaData?.nodesMap?.[nodeType]
      if (!nodeDefault?.defaultValue) return

      const nodeData = getStartNodeData(nodeType, nodeDefault.defaultValue, toolConfig)

      selectStartNode(
        (nodes) => {
          const placeholder = nodes.find(
            (node) => node.id === id && node.data.type === BlockEnum.StartPlaceholder,
          )
          if (placeholder)
            return {
              ...placeholder,
              data: { ...placeholder.data, ...nodeData, selected: true },
            }
        },
        () => {
          setHasSelectedStartNode?.(true)
          setShouldAutoOpenStartNodeSelector?.(true)
        },
      )
    },
    [
      selectStartNode,
      availableNodesMetaData?.nodesMap,
      id,
      setHasSelectedStartNode,
      setShouldAutoOpenStartNodeSelector,
    ],
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-3 py-2">
        <PluginSearchInput
          value={searchText}
          onValueChange={setSearchText}
          tags={tags}
          onTagsChange={setTags}
          placeholder={t(($) => $['tabs.searchTrigger'], { ns: 'workflow' })}
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
