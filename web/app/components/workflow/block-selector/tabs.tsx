import type { Dispatch, FC, SetStateAction } from 'react'
import type {
  BlockEnum,
  NodeDefault,
  OnSelectBlock,
  ToolWithProvider,
} from '../types'
import { memo, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useFeaturedToolsRecommendations } from '@/service/use-plugins'
import { useAllBuiltInTools, useAllCustomTools, useAllMCPTools, useAllWorkflowTools, useInvalidateAllBuiltInTools } from '@/service/use-tools'
import { cn } from '@/utils/classnames'
import { basePath } from '@/utils/var'
import { useWorkflowStore } from '../store'
import AllStartBlocks from './all-start-blocks'
import AllTools from './all-tools'
import Blocks from './blocks'
import DataSources from './data-sources'
import { TabsEnum } from './types'

export type TabsProps = {
  activeTab: TabsEnum
  onActiveTabChange: (activeTab: TabsEnum) => void
  searchText: string
  tags: string[]
  onTagsChange: Dispatch<SetStateAction<string[]>>
  onSelect: OnSelectBlock
  availableBlocksTypes?: BlockEnum[]
  blocks: NodeDefault[]
  dataSources?: ToolWithProvider[]
  tabs: Array<{
    key: TabsEnum
    name: string
    disabled?: boolean
  }>
  filterElem: React.ReactNode
  noBlocks?: boolean
  noTools?: boolean
  forceShowStartContent?: boolean // Force show Start content even when noBlocks=true
  allowStartNodeSelection?: boolean // Allow user input option even when trigger node already exists (e.g. change-node flow or when no Start node yet).
}
const Tabs: FC<TabsProps> = ({
  activeTab,
  onActiveTabChange,
  tags,
  onTagsChange,
  searchText,
  onSelect,
  availableBlocksTypes,
  blocks,
  dataSources = [],
  tabs = [],
  filterElem,
  noBlocks,
  noTools,
  forceShowStartContent = false,
  allowStartNodeSelection = false,
}) => {
  const { t } = useTranslation()
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()
  const invalidateBuiltInTools = useInvalidateAllBuiltInTools()
  const { enable_marketplace } = useGlobalPublicStore(s => s.systemFeatures)
  const workflowStore = useWorkflowStore()
  const inRAGPipeline = dataSources.length > 0
  const {
    plugins: featuredPlugins = [],
    isLoading: isFeaturedLoading,
  } = useFeaturedToolsRecommendations(enable_marketplace && !inRAGPipeline)

  const normalizeToolList = useMemo(() => {
    return (list?: ToolWithProvider[]) => {
      if (!list)
        return list
      if (!basePath)
        return list
      let changed = false
      const normalized = list.map((provider) => {
        if (typeof provider.icon === 'string') {
          const icon = provider.icon
          const shouldPrefix = Boolean(basePath)
            && icon.startsWith('/')
            && !icon.startsWith(`${basePath}/`)

          if (shouldPrefix) {
            changed = true
            return {
              ...provider,
              icon: `${basePath}${icon}`,
            }
          }
        }
        return provider
      })
      return changed ? normalized : list
    }
  }, [basePath])

  useEffect(() => {
    workflowStore.setState((state) => {
      const updates: Partial<typeof state> = {}
      const normalizedBuiltIn = normalizeToolList(buildInTools)
      const normalizedCustom = normalizeToolList(customTools)
      const normalizedWorkflow = normalizeToolList(workflowTools)
      const normalizedMCP = normalizeToolList(mcpTools)

      if (normalizedBuiltIn !== undefined && state.buildInTools !== normalizedBuiltIn)
        updates.buildInTools = normalizedBuiltIn
      if (normalizedCustom !== undefined && state.customTools !== normalizedCustom)
        updates.customTools = normalizedCustom
      if (normalizedWorkflow !== undefined && state.workflowTools !== normalizedWorkflow)
        updates.workflowTools = normalizedWorkflow
      if (normalizedMCP !== undefined && state.mcpTools !== normalizedMCP)
        updates.mcpTools = normalizedMCP
      if (!Object.keys(updates).length)
        return state
      return {
        ...state,
        ...updates,
      }
    })
  }, [workflowStore, normalizeToolList, buildInTools, customTools, workflowTools, mcpTools])

  return (
    <div onClick={e => e.stopPropagation()}>
      {
        !noBlocks && (
          <div className="relative flex bg-background-section-burn pl-1 pt-1">
            {
              tabs.map((tab) => {
                const commonProps = {
                  'className': cn(
                    'system-sm-medium relative mr-0.5 flex h-8 items-center rounded-t-lg px-3',
                    tab.disabled
                      ? 'cursor-not-allowed text-text-disabled opacity-60'
                      : activeTab === tab.key
                        ? 'sm-no-bottom cursor-default bg-components-panel-bg text-text-accent'
                        : 'cursor-pointer text-text-tertiary',
                  ),
                  'aria-disabled': tab.disabled,
                  'onClick': () => {
                    if (tab.disabled || activeTab === tab.key)
                      return
                    onActiveTabChange(tab.key)
                  },
                } as const
                if (tab.disabled) {
                  return (
                    <Tooltip
                      key={tab.key}
                      position="top"
                      popupClassName="max-w-[200px]"
                      popupContent={t('tabs.startDisabledTip', { ns: 'workflow' })}
                    >
                      <div {...commonProps}>
                        {tab.name}
                      </div>
                    </Tooltip>
                  )
                }
                return (
                  <div
                    key={tab.key}
                    {...commonProps}
                  >
                    {tab.name}
                  </div>
                )
              })
            }
          </div>
        )
      }
      {filterElem}
      {
        activeTab === TabsEnum.Start && (!noBlocks || forceShowStartContent) && (
          <div className="border-t border-divider-subtle">
            <AllStartBlocks
              allowUserInputSelection={allowStartNodeSelection}
              searchText={searchText}
              onSelect={onSelect}
              availableBlocksTypes={availableBlocksTypes}
              tags={tags}
            />
          </div>
        )
      }
      {
        activeTab === TabsEnum.Blocks && !noBlocks && (
          <div className="border-t border-divider-subtle">
            <Blocks
              searchText={searchText}
              onSelect={onSelect}
              availableBlocksTypes={availableBlocksTypes}
              blocks={blocks}
            />
          </div>
        )
      }
      {
        activeTab === TabsEnum.Sources && !!dataSources.length && (
          <div className="border-t border-divider-subtle">
            <DataSources
              searchText={searchText}
              onSelect={onSelect}
              dataSources={dataSources}
            />
          </div>
        )
      }
      {
        activeTab === TabsEnum.Tools && !noTools && (
          <AllTools
            searchText={searchText}
            onSelect={onSelect}
            tags={tags}
            canNotSelectMultiple
            buildInTools={buildInTools || []}
            customTools={customTools || []}
            workflowTools={workflowTools || []}
            mcpTools={mcpTools || []}
            onTagsChange={onTagsChange}
            isInRAGPipeline={inRAGPipeline}
            featuredPlugins={featuredPlugins}
            featuredLoading={isFeaturedLoading}
            showFeatured={enable_marketplace && !inRAGPipeline}
            onFeaturedInstallSuccess={async () => {
              invalidateBuiltInTools()
            }}
          />
        )
      }
    </div>
  )
}

export default memo(Tabs)
