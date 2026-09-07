import type { ReactNode, Ref } from 'react'
import type { BlockEnum, NodeDefault, OnNodeAdd, OnSelectBlock, ToolWithProvider } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import SearchBox from '@/app/components/plugins/marketplace/search-box'
import AllStartBlocks from './all-start-blocks'
import Blocks from './blocks'
import DataSources from './data-sources'
import Snippets from './snippets'
import { ToolPanel } from './tool-panel'
import { TabType } from './types'

type TabConfig = {
  key: TabType
  name: string
  disabled?: boolean
  disabledTip?: ReactNode
}

type BlockSelectorPanelsProps = {
  defaultTab: TabType
  standalonePanel?: TabType
  tabs: TabConfig[]
  searchInputRef: Ref<HTMLInputElement>
  onSelect: OnSelectBlock
  onRequestClose: () => void
  availableBlocksTypes?: BlockEnum[]
  blocks: NodeDefault[]
  dataSources?: ToolWithProvider[]
  allowStartNodeSelection?: boolean
  hasUserInputNode?: boolean
  hasTriggerNode?: boolean
  snippetInsertPayload?: Parameters<OnNodeAdd>[1]
}

type TabFilterState = Record<
  TabType,
  {
    searchText: string
    tags: string[]
  }
>

const createTabFilterState = (): TabFilterState => ({
  [TabType.Blocks]: { searchText: '', tags: [] },
  [TabType.Tools]: { searchText: '', tags: [] },
  [TabType.Sources]: { searchText: '', tags: [] },
  [TabType.Start]: { searchText: '', tags: [] },
  [TabType.Snippets]: { searchText: '', tags: [] },
})

function TabHeaderItem({
  tab,
  fallbackDisabledTip,
}: {
  tab: TabConfig
  fallbackDisabledTip: ReactNode
}) {
  const tabElement = (
    <TabsTab
      value={tab.key}
      disabled={tab.disabled}
      className={cn(
        'z-10 mr-0.5 h-8 rounded-t-lg border-b-0 px-3 py-0 system-sm-medium text-text-tertiary',
        'data-active:cursor-default data-active:border-transparent data-active:text-text-accent',
        'data-disabled:text-text-disabled data-disabled:opacity-60',
      )}
    >
      {tab.name}
    </TabsTab>
  )

  if (!tab.disabled) return tabElement

  return (
    <Tooltip>
      <TooltipTrigger render={tabElement} />
      <TooltipContent placement="top" className="max-w-57.5 rounded-xl px-4 py-3.5">
        {tab.disabledTip || fallbackDisabledTip}
      </TooltipContent>
    </Tooltip>
  )
}

function BlockSelectorPanels({
  defaultTab,
  standalonePanel,
  tabs,
  searchInputRef,
  onSelect,
  onRequestClose,
  availableBlocksTypes,
  blocks,
  dataSources = [],
  allowStartNodeSelection = false,
  hasUserInputNode = false,
  hasTriggerNode = false,
  snippetInsertPayload,
}: BlockSelectorPanelsProps) {
  const { t } = useTranslation()
  const [filters, setFilters] = useState(createTabFilterState)
  const fallbackDisabledTip = t(($) => $['tabs.startDisabledTip'], { ns: 'workflow' })

  const setSearchText = (tab: TabType, searchText: string) => {
    setFilters((currentFilters) => ({
      ...currentFilters,
      [tab]: { ...currentFilters[tab], searchText },
    }))
  }

  const setTags = (tab: TabType, tags: string[]) => {
    setFilters((currentFilters) => ({
      ...currentFilters,
      [tab]: { ...currentFilters[tab], tags },
    }))
  }

  const renderSearchFilter = (tab: TabType, inputRef?: Ref<HTMLInputElement>) => {
    if (tab === TabType.Snippets) return null
    const { searchText, tags } = filters[tab]

    const filter = (() => {
      if (tab === TabType.Start) {
        return (
          <SearchBox
            ref={inputRef}
            search={searchText}
            onSearchChange={(value) => setSearchText(tab, value)}
            tags={tags}
            onTagsChange={(value) => setTags(tab, value)}
            placeholder={t(($) => $['tabs.searchTrigger'], { ns: 'workflow' })}
            inputClassName="grow"
          />
        )
      }

      if (tab === TabType.Tools) {
        return (
          <SearchBox
            ref={inputRef}
            search={searchText}
            onSearchChange={(value) => setSearchText(tab, value)}
            tags={tags}
            onTagsChange={(value) => setTags(tab, value)}
            placeholder={t(($) => $.searchTools, { ns: 'plugin' })!}
            inputClassName="grow"
          />
        )
      }

      return (
        <SearchInput
          ref={inputRef}
          value={searchText}
          placeholder={
            tab === TabType.Blocks
              ? t(($) => $['tabs.searchBlock'], { ns: 'workflow' })
              : t(($) => $['tabs.searchDataSource'], { ns: 'workflow' })
          }
          aria-label={
            tab === TabType.Blocks
              ? t(($) => $['tabs.searchBlock'], { ns: 'workflow' })
              : t(($) => $['tabs.searchDataSource'], { ns: 'workflow' })
          }
          onValueChange={(value) => setSearchText(tab, value)}
        />
      )
    })()

    return <div className="relative m-2">{filter}</div>
  }

  const renderPanel = (tab: TabType, inputRef?: Ref<HTMLInputElement>) => {
    const searchFilter = renderSearchFilter(tab, inputRef)

    if (tab === TabType.Start) {
      return (
        <>
          {searchFilter}
          <div className="border-t border-divider-subtle">
            <AllStartBlocks
              allowUserInputSelection={allowStartNodeSelection}
              hasUserInputNode={hasUserInputNode}
              hasTriggerNode={hasTriggerNode}
              searchText={filters[TabType.Start].searchText}
              onSelect={onSelect}
              availableBlocksTypes={availableBlocksTypes}
              tags={filters[TabType.Start].tags}
            />
          </div>
        </>
      )
    }

    if (tab === TabType.Blocks) {
      return (
        <>
          {searchFilter}
          <div className="border-t border-divider-subtle">
            <Blocks
              searchText={filters[TabType.Blocks].searchText}
              onSelect={onSelect}
              availableBlocksTypes={availableBlocksTypes}
              blocks={blocks}
            />
          </div>
        </>
      )
    }

    if (tab === TabType.Sources) {
      return (
        <>
          {searchFilter}
          <div className="border-t border-divider-subtle">
            <DataSources
              searchText={filters[TabType.Sources].searchText}
              onSelect={onSelect}
              dataSources={dataSources}
            />
          </div>
        </>
      )
    }

    if (tab === TabType.Tools) {
      return (
        <>
          {searchFilter}
          <ToolPanel
            searchText={filters[TabType.Tools].searchText}
            onSelect={onSelect}
            tags={filters[TabType.Tools].tags}
            onTagsChange={(value) => setTags(TabType.Tools, value)}
            dataSources={dataSources}
          />
        </>
      )
    }

    return (
      <Snippets
        searchText={filters[TabType.Snippets].searchText}
        onSearchTextChange={(value) => setSearchText(TabType.Snippets, value)}
        insertPayload={snippetInsertPayload}
        onInserted={onRequestClose}
      />
    )
  }

  if (standalonePanel) {
    return (
      <div className="w-full min-w-0">
        {renderPanel(
          standalonePanel,
          standalonePanel === TabType.Snippets ? undefined : searchInputRef,
        )}
      </div>
    )
  }

  return (
    <Tabs defaultValue={defaultTab} className="w-full min-w-0">
      <TabsList
        aria-label={t(($) => $['common.addBlock'], { ns: 'workflow' })}
        className="relative w-full min-w-0 gap-0 bg-background-section-burn pt-1 pl-1"
      >
        {tabs.map((tab) => (
          <TabHeaderItem key={tab.key} tab={tab} fallbackDisabledTip={fallbackDisabledTip} />
        ))}
        <TabsIndicator
          className="sm-no-bottom pointer-events-none absolute left-0 rounded-t-lg bg-components-panel-bg transition-[translate,width] duration-150 ease-in-out motion-reduce:transition-none"
          style={{
            top: 'var(--active-tab-top)',
            translate: 'var(--active-tab-left)',
            width: 'var(--active-tab-width)',
            height: 'var(--active-tab-height)',
          }}
        />
      </TabsList>
      {tabs.map((tab) => (
        <TabsPanel key={tab.key} value={tab.key} tabIndex={-1}>
          {renderPanel(
            tab.key,
            tab.key === defaultTab && tab.key !== TabType.Snippets ? searchInputRef : undefined,
          )}
        </TabsPanel>
      ))}
    </Tabs>
  )
}

export { BlockSelectorPanels }
