'use client'
import type {
  OffsetOptions,
  Placement,
} from '@floating-ui/react'
import type { FC } from 'react'
import type { ToolDefaultValue, ToolValue } from './types'
import type { CustomCollectionBackend } from '@/app/components/tools/types'
import type { BlockEnum, OnSelectBlock } from '@/app/components/workflow/types'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Toast from '@/app/components/base/toast'
import SearchBox from '@/app/components/plugins/marketplace/search-box'
import EditCustomToolModal from '@/app/components/tools/edit-custom-collection-modal'
import AllTools from '@/app/components/workflow/block-selector/all-tools'
import { useGlobalPublicStore } from '@/context/global-public-context'
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
import { cn } from '@/utils/classnames'

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

  const { enable_marketplace } = useGlobalPublicStore(s => s.systemFeatures)
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

  const handleTriggerClick = () => {
    if (disabled)
      return
    onShowChange(true)
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
    Toast.notify({
      type: 'success',
      message: t('api.actionSuccess', { ns: 'common' }),
    })
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
    <PortalToFollowElem
      placement={placement}
      offset={offset}
      open={isShow}
      onOpenChange={onShowChange}
    >
      <PortalToFollowElemTrigger
        onClick={handleTriggerClick}
      >
        {trigger}
      </PortalToFollowElemTrigger>

      <PortalToFollowElemContent className="z-[1000]">
        <div className={cn('relative min-h-20 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-sm', panelClassName)}>
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
            toolContentClassName="max-w-[100%]"
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
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default React.memo(ToolPicker)
