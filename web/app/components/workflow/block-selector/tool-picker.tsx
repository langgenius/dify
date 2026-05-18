'use client'
import type { OffsetOptions } from '@floating-ui/react'
import type { Placement } from '@langgenius/dify-ui/popover'
import type { FC } from 'react'
import type { ToolDefaultValue, ToolValue } from './types'
import type { CustomCollectionBackend } from '@/app/components/tools/types'
import type { BlockEnum, OnSelectBlock } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { toast } from '@langgenius/dify-ui/toast'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SearchBox from '@/app/components/plugins/marketplace/search-box'
import EditCustomToolModal from '@/app/components/tools/edit-custom-collection-modal'
import AllTools from '@/app/components/workflow/block-selector/all-tools'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import {
  createCustomCollection,
} from '@/service/tools'
import { useFeaturedToolsRecommendations } from '@/service/use-plugins'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
  useInvalidateAllBuiltInTools,
  useInvalidateAllCustomTools,
  useInvalidateAllMCPTools,
  useInvalidateAllWorkflowTools,
} from '@/service/use-tools'

type Props = {
  panelClassName?: string
  disabled: boolean
  trigger: React.ReactNode
  placement?: Placement
  offset?: OffsetOptions
  isShow: boolean
  onShowChange: (isShow: boolean) => void
  onSelect: (tool: ToolDefaultValue) => void
  onSelectMultiple: (tools: ToolDefaultValue[]) => void
  supportAddCustomTool?: boolean
  scope?: string
  selectedTools?: ToolValue[]
}

const ToolPicker: FC<Props> = ({
  disabled,
  trigger,
  placement = 'right-start',
  offset = 0,
  isShow,
  onShowChange,
  onSelect,
  onSelectMultiple,
  supportAddCustomTool,
  scope = 'all',
  selectedTools,
  panelClassName,
}) => {
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const sideOffset = typeof offset === 'number' ? offset : (typeof offset === 'function' ? 0 : (offset?.mainAxis ?? 0))
  const alignOffset = typeof offset === 'number' ? 0 : (typeof offset === 'function' ? 0 : (offset?.crossAxis ?? 0))

  const { data: enable_marketplace } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.enable_marketplace,
  })
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const invalidateCustomTools = useInvalidateAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()
  const invalidateBuiltInTools = useInvalidateAllBuiltInTools()
  const invalidateWorkflowTools = useInvalidateAllWorkflowTools()
  const invalidateMcpTools = useInvalidateAllMCPTools()

  const {
    plugins: featuredPlugins = [],
    isLoading: isFeaturedLoading,
  } = useFeaturedToolsRecommendations(enable_marketplace)

  const { builtinToolList, customToolList, workflowToolList } = useMemo(() => {
    if (scope === 'plugins') {
      return {
        builtinToolList: buildInTools,
        customToolList: [],
        workflowToolList: [],
      }
    }
    if (scope === 'custom') {
      return {
        builtinToolList: [],
        customToolList: customTools,
        workflowToolList: [],
      }
    }
    if (scope === 'workflow') {
      return {
        builtinToolList: [],
        customToolList: [],
        workflowToolList: workflowTools,
      }
    }
    return {
      builtinToolList: buildInTools,
      customToolList: customTools,
      workflowToolList: workflowTools,
    }
  }, [scope, buildInTools, customTools, workflowTools])

  const handleAddedCustomTool = invalidateCustomTools

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && disabled)
      return
    onShowChange(nextOpen)
  }

  const handleSelect = (_type: BlockEnum, tool?: ToolDefaultValue) => {
    onSelect(tool!)
  }

  const handleSelectMultiple = (_type: BlockEnum, tools: ToolDefaultValue[]) => {
    onSelectMultiple(tools)
  }

  const [isShowEditCollectionToolModal, {
    setFalse: hideEditCustomCollectionModal,
    setTrue: showEditCustomCollectionModal,
  }] = useBoolean(false)

  const doCreateCustomToolCollection = async (data: CustomCollectionBackend) => {
    await createCustomCollection(data)
    toast.success(t('api.actionSuccess', { ns: 'common' }))
    hideEditCustomCollectionModal()
    handleAddedCustomTool()
  }

  if (isShowEditCollectionToolModal) {
    return (
      <EditCustomToolModal
        dialogClassName="bg-background-overlay"
        payload={null}
        onHide={hideEditCustomCollectionModal}
        onAdd={doCreateCustomToolCollection}
      />
    )
  }

  return (
    <Popover
      open={isShow}
      onOpenChange={handleOpenChange}
    >
      <PopoverTrigger
        nativeButton={false}
        render={<div className="inline-block" />}
      >
        {trigger}
      </PopoverTrigger>

      <PopoverContent
        placement={placement}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        popupClassName="border-none bg-transparent shadow-none"
      >
        <div className={cn('relative min-h-20 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-xs', panelClassName)}>
          <div className="p-2 pb-1">
            <SearchBox
              search={searchText}
              onSearchChange={setSearchText}
              tags={tags}
              onTagsChange={setTags}
              placeholder={t('searchTools', { ns: 'plugin' })!}
              supportAddCustomTool={supportAddCustomTool}
              onAddedCustomTool={handleAddedCustomTool}
              onShowAddCustomCollectionModal={showEditCustomCollectionModal}
              inputClassName="grow"
            />
          </div>
          <AllTools
            className="mt-1"
            toolContentClassName="max-w-full"
            tags={tags}
            searchText={searchText}
            onSelect={handleSelect as OnSelectBlock}
            onSelectMultiple={handleSelectMultiple}
            buildInTools={builtinToolList || []}
            customTools={customToolList || []}
            workflowTools={workflowToolList || []}
            mcpTools={mcpTools || []}
            selectedTools={selectedTools}
            onTagsChange={setTags}
            featuredPlugins={featuredPlugins}
            featuredLoading={isFeaturedLoading}
            showFeatured={scope === 'all' && enable_marketplace}
            onFeaturedInstallSuccess={async () => {
              invalidateBuiltInTools()
              invalidateCustomTools()
              invalidateWorkflowTools()
              invalidateMcpTools()
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default React.memo(ToolPicker)
