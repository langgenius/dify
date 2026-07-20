import type { ReactNode, Ref } from 'react'
import type { BlockEnum, NodeDefault, OnNodeAdd, OnSelectBlock, ToolWithProvider } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useDebounce } from 'ahooks'
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

type SelectorContentProps = {
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
      <TooltipContent placement="top" className="max-w-[230px] rounded-xl px-4 py-3.5">
        {tab.disabledTip || fallbackDisabledTip}
      </TooltipContent>
    </Tooltip>
  )
}

function SelectorContent({
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
}: SelectorContentProps) {
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState('')
  const debouncedSearchText = useDebounce(searchText, { wait: 500 })
  const [tags, setTags] = useState<string[]>([])
  const fallbackDisabledTip = t(($) => $['tabs.startDisabledTip'], { ns: 'workflow' })

  const renderSearchFilter = (tab: TabType, inputRef?: Ref<HTMLInputElement>) => {
    if (tab === TabType.Snippets) return null

    const filter = (() => {
      if (tab === TabType.Start) {
        return (
          <SearchBox
            ref={inputRef}
            search={searchText}
            onSearchChange={setSearchText}
            tags={tags}
            onTagsChange={setTags}
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
            onSearchChange={setSearchText}
            tags={tags}
            onTagsChange={setTags}
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
          onValueChange={setSearchText}
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
              searchText={debouncedSearchText}
              onSelect={onSelect}
              availableBlocksTypes={availableBlocksTypes}
              tags={tags}
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
              searchText={searchText}
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
            <DataSources searchText={searchText} onSelect={onSelect} dataSources={dataSources} />
          </div>
        </>
      )
    }

    if (tab === TabType.Tools) {
      return (
        <>
          {searchFilter}
          <ToolPanel
            searchText={debouncedSearchText}
            onSelect={onSelect}
            tags={tags}
            onTagsChange={setTags}
            dataSources={dataSources}
          />
        </>
      )
    }

    return (
      <Snippets
        searchText={searchText}
        onSearchTextChange={setSearchText}
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
      <TabsList className="relative w-full min-w-0 gap-0 bg-background-section-burn pt-1 pl-1">
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
        <TabsPanel
          key={tab.key}
          value={tab.key}
          className="focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden focus-visible:ring-inset"
        >
          {renderPanel(
            tab.key,
            tab.key === defaultTab && tab.key !== TabType.Snippets ? searchInputRef : undefined,
          )}
        </TabsPanel>
      ))}
    </Tabs>
  )
}

export { SelectorContent }
