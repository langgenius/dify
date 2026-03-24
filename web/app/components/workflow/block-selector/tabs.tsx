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

const normalizeToolList = (list: ToolWithProvider[] | undefined, currentBasePath?: string) => {
  if (!list || !currentBasePath)
    return list

  let changed = false
  const normalized = list.map((provider) => {
    if (typeof provider.icon !== 'string')
      return provider

    const shouldPrefix = provider.icon.startsWith('/')
      && !provider.icon.startsWith(`${currentBasePath}/`)

    if (!shouldPrefix)
      return provider

    changed = true
    return {
      ...provider,
      icon: `${currentBasePath}${provider.icon}`,
    }
  })

  return changed ? normalized : list
}

const getStoreToolUpdates = ({
  state,
  buildInTools,
  customTools,
  workflowTools,
  mcpTools,
}: {
  state: {
    buildInTools?: ToolWithProvider[]
    customTools?: ToolWithProvider[]
    workflowTools?: ToolWithProvider[]
    mcpTools?: ToolWithProvider[]
  }
  buildInTools?: ToolWithProvider[]
  customTools?: ToolWithProvider[]
  workflowTools?: ToolWithProvider[]
  mcpTools?: ToolWithProvider[]
}) => {
  const updates: Partial<typeof state> = {}

  if (buildInTools !== undefined && state.buildInTools !== buildInTools)
    updates.buildInTools = buildInTools
  if (customTools !== undefined && state.customTools !== customTools)
    updates.customTools = customTools
  if (workflowTools !== undefined && state.workflowTools !== workflowTools)
    updates.workflowTools = workflowTools
  if (mcpTools !== undefined && state.mcpTools !== mcpTools)
    updates.mcpTools = mcpTools

  return updates
}

const TabHeaderItem = ({
  tab,
  activeTab,
  onActiveTabChange,
  disabledTip,
}: {
  tab: TabsProps['tabs'][number]
  activeTab: TabsEnum
  onActiveTabChange: (activeTab: TabsEnum) => void
  disabledTip: string
}) => {
  const className = cn(
    'relative mr-0.5 flex h-8 items-center rounded-t-lg px-3 system-sm-medium',
    tab.disabled
      ? 'cursor-not-allowed text-text-disabled opacity-60'
      : activeTab === tab.key
        // eslint-disable-next-line tailwindcss/no-unknown-classes
        ? 'sm-no-bottom cursor-default bg-components-panel-bg text-text-accent'
        : 'cursor-pointer text-text-tertiary',
  )

  const handleClick = () => {
    if (tab.disabled || activeTab === tab.key)
      return
    onActiveTabChange(tab.key)
  }

  if (tab.disabled) {
    return (
      <Tooltip
        key={tab.key}
        position="top"
        popupClassName="max-w-[200px]"
        popupContent={disabledTip}
      >
        <div
          className={className}
          aria-disabled={tab.disabled}
          onClick={handleClick}
        >
          {tab.name}
        </div>
      </Tooltip>
    )
  }

  return (
    <div
      key={tab.key}
      className={className}
      aria-disabled={tab.disabled}
      onClick={handleClick}
    >
      {tab.name}
    </div>
  )
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
  const normalizedBuiltInTools = useMemo(() => normalizeToolList(buildInTools, basePath), [buildInTools])
  const normalizedCustomTools = useMemo(() => normalizeToolList(customTools, basePath), [customTools])
  const normalizedWorkflowTools = useMemo(() => normalizeToolList(workflowTools, basePath), [workflowTools])
  const normalizedMcpTools = useMemo(() => normalizeToolList(mcpTools, basePath), [mcpTools])
  const disabledTip = t('tabs.startDisabledTip', { ns: 'workflow' })

  useEffect(() => {
    workflowStore.setState((state) => {
      const updates = getStoreToolUpdates({
        state,
        buildInTools: normalizedBuiltInTools,
        customTools: normalizedCustomTools,
        workflowTools: normalizedWorkflowTools,
        mcpTools: normalizedMcpTools,
      })
      if (!Object.keys(updates).length)
        return state
      return {
        ...state,
        ...updates,
      }
    })
  }, [normalizedBuiltInTools, normalizedCustomTools, normalizedMcpTools, normalizedWorkflowTools, workflowStore])

  return (
    <div onClick={e => e.stopPropagation()}>
      {
        !noBlocks && (
          <div className="relative flex bg-background-section-burn pl-1 pt-1">
            {
              tabs.map(tab => (
                <TabHeaderItem
                  key={tab.key}
                  tab={tab}
                  activeTab={activeTab}
                  onActiveTabChange={onActiveTabChange}
                  disabledTip={disabledTip}
                />
              ))
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
            buildInTools={normalizedBuiltInTools || []}
            customTools={normalizedCustomTools || []}
            workflowTools={normalizedWorkflowTools || []}
            mcpTools={normalizedMcpTools || []}
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
