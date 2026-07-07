import type {
  OffsetOptions,
  Placement,
} from '@floating-ui/react'
import type {
  MouseEventHandler,
} from 'react'
import type {
  CommonNodeType,
  NodeDefault,
  OnNodeAdd,
  OnSelectBlock,
  ToolWithProvider,
} from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { useDebounce } from 'ahooks'
import * as React from 'react'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import SearchBox from '@/app/components/plugins/marketplace/search-box'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import useNodes from '@/app/components/workflow/store/workflow/use-nodes'
import { FlowType } from '@/types/common'
import { BlockEnum, isTriggerNode } from '../types'
import { useTabs } from './hooks'
import Snippets from './snippets'
import Tabs from './tabs'
import { TabsEnum } from './types'

export type NodeSelectorProps = {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSelect: OnSelectBlock
  trigger?: (open: boolean) => React.ReactNode
  placement?: Placement
  offset?: OffsetOptions
  triggerStyle?: React.CSSProperties
  triggerClassName?: (open: boolean) => string
  triggerInnerClassName?: string
  renderTriggerAsButtonRoot?: boolean
  popupClassName?: string
  availableBlocksTypes?: BlockEnum[]
  disabled?: boolean
  blocks?: NodeDefault[]
  dataSources?: ToolWithProvider[]
  noBlocks?: boolean
  noTools?: boolean
  showStartTab?: boolean
  defaultActiveTab?: TabsEnum
  forceShowStartContent?: boolean
  ignoreNodeIds?: string[]
  forceEnableStartTab?: boolean // Force enabling Start tab regardless of existing trigger/user input nodes (e.g., when changing Start node type).
  allowUserInputSelection?: boolean // Override user-input availability; default logic blocks it when triggers exist.
  snippetInsertPayload?: Parameters<OnNodeAdd>[1]
  isolateKeyboardEvents?: boolean
}
function NodeSelector({
  open: openFromProps,
  onOpenChange,
  onSelect,
  trigger,
  placement = 'right',
  offset = 6,
  triggerClassName,
  triggerInnerClassName,
  renderTriggerAsButtonRoot = false,
  triggerStyle,
  popupClassName,
  availableBlocksTypes,
  disabled,
  blocks = [],
  dataSources = [],
  noBlocks = false,
  noTools = false,
  showStartTab = false,
  defaultActiveTab,
  forceShowStartContent = false,
  ignoreNodeIds = [],
  forceEnableStartTab = false,
  allowUserInputSelection,
  snippetInsertPayload,
  isolateKeyboardEvents = false,
}: NodeSelectorProps) {
  const { t } = useTranslation()
  const nodes = useNodes()
  const flowType = useHooksStore(s => s.configsMap?.flowType)
  const [searchText, setSearchText] = useState('')
  const [snippetsLoading, setSnippetsLoading] = useState(() => Boolean(openFromProps) && defaultActiveTab === TabsEnum.Snippets)
  const debouncedSearchText = useDebounce(searchText, { wait: 500 })
  const [tags, setTags] = useState<string[]>([])
  const [localOpen, setLocalOpen] = useState(false)
  // Exclude nodes explicitly ignored (such as the node currently being edited) when checking canvas state.
  const filteredNodes = useMemo(() => {
    if (!ignoreNodeIds.length)
      return nodes
    const ignoreSet = new Set(ignoreNodeIds)
    return nodes.filter(node => !ignoreSet.has(node.id))
  }, [nodes, ignoreNodeIds])

  const { hasTriggerNode, hasUserInputNode, hasStartPlaceholderNode } = useMemo(() => {
    const result = {
      hasTriggerNode: false,
      hasUserInputNode: false,
      hasStartPlaceholderNode: false,
    }
    for (const node of filteredNodes) {
      const nodeType = (node.data as CommonNodeType | undefined)?.type
      if (!nodeType)
        continue
      if (nodeType === BlockEnum.Start)
        result.hasUserInputNode = true
      if (nodeType === BlockEnum.StartPlaceholder)
        result.hasStartPlaceholderNode = true
      if (isTriggerNode(nodeType))
        result.hasTriggerNode = true
      if (result.hasTriggerNode && result.hasUserInputNode && result.hasStartPlaceholderNode)
        break
    }
    return result
  }, [filteredNodes])
  // Default rule: user input option is only available when no Start node nor Trigger node exists on canvas.
  const defaultAllowUserInputSelection = !hasUserInputNode && !hasTriggerNode
  const canSelectUserInput = allowUserInputSelection ?? defaultAllowUserInputSelection
  const disableStartTab = flowType === FlowType.snippet
  const disableSnippetsTab = flowType === FlowType.snippet
  const {
    activeTab,
    resetActiveTab,
    setActiveTab,
    tabs,
  } = useTabs({
    noBlocks,
    noSources: !dataSources.length,
    noTools,
    noSnippets: disableSnippetsTab,
    noStart: !showStartTab,
    defaultActiveTab,
    hasStartPlaceholderNode,
    disableStartTab,
    forceEnableStartTab,
  })
  const open = openFromProps === undefined ? localOpen : openFromProps
  const handleOpenChange = useCallback((newOpen: boolean) => {
    if (disabled)
      return

    setLocalOpen(newOpen)

    if (!newOpen) {
      setSearchText('')
      setSnippetsLoading(false)
      resetActiveTab()
    }
    else if (activeTab === TabsEnum.Snippets) {
      setSnippetsLoading(true)
    }

    if (onOpenChange)
      onOpenChange(newOpen)
  }, [activeTab, disabled, onOpenChange, resetActiveTab])
  const handleTrigger = useCallback<MouseEventHandler<HTMLElement>>((e) => {
    e.stopPropagation()
  }, [])

  const handleSelect = useCallback<OnSelectBlock>((type, pluginDefaultValue) => {
    handleOpenChange(false)
    onSelect(type, pluginDefaultValue)
  }, [handleOpenChange, onSelect])

  const handleActiveTabChange = useCallback((newActiveTab: TabsEnum) => {
    setActiveTab(newActiveTab)
    if (open && newActiveTab === TabsEnum.Snippets)
      setSnippetsLoading(true)
  }, [open, setActiveTab])
  const handlePopupKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (isolateKeyboardEvents)
      event.stopPropagation()
  }, [isolateKeyboardEvents])

  useEffect(() => {
    if (!snippetsLoading)
      return

    const timer = window.setTimeout(() => {
      setSnippetsLoading(false)
    }, 200)

    return () => {
      window.clearTimeout(timer)
    }
  }, [snippetsLoading])
  const filterSearchText = activeTab === TabsEnum.Start || activeTab === TabsEnum.Tools
    ? debouncedSearchText
    : searchText

  const searchPlaceholder = useMemo(() => {
    if (activeTab === TabsEnum.Start)
      return t('tabs.searchTrigger', { ns: 'workflow' })

    if (activeTab === TabsEnum.Blocks)
      return t('tabs.searchBlock', { ns: 'workflow' })

    if (activeTab === TabsEnum.Tools)
      return t('tabs.searchTool', { ns: 'workflow' })

    if (activeTab === TabsEnum.Sources)
      return t('tabs.searchDataSource', { ns: 'workflow' })
    if (activeTab === TabsEnum.Snippets)
      return t('tabs.searchSnippets', { ns: 'workflow' })
    return ''
  }, [activeTab, t])

  const defaultTriggerElement = (
    <PopoverTrigger
      aria-label={t('common.addBlock', { ns: 'workflow' })}
      className={cn(
        'z-10 flex size-4 cursor-pointer items-center justify-center rounded-full border-0 bg-components-button-primary-bg p-0 text-text-primary-on-surface hover:bg-components-button-primary-bg-hover focus-visible:ring-1 focus-visible:ring-components-input-border-hover focus-visible:outline-hidden',
        triggerClassName?.(open),
      )}
      style={triggerStyle}
      onClick={handleTrigger}
    >
      <span aria-hidden className="i-custom-vender-line-general-plus-02 size-2.5" />
    </PopoverTrigger>
  )
  const triggerElement = trigger?.(open)
  const isValidTriggerElement = React.isValidElement(triggerElement)
  const isNativeButtonTrigger = isValidTriggerElement && triggerElement.type === 'button'
  const shouldRenderTriggerAsButtonRoot = isValidTriggerElement && (renderTriggerAsButtonRoot || isNativeButtonTrigger)
  const resolvedTriggerElement = shouldRenderTriggerAsButtonRoot
    ? triggerElement
    : (
        <div className={triggerInnerClassName}>
          {triggerElement}
        </div>
      )
  const resolvedOffset = typeof offset === 'number' || typeof offset === 'function' ? undefined : offset
  const sideOffset = typeof offset === 'number' ? offset : (resolvedOffset?.mainAxis ?? 0)
  const alignOffset = typeof offset === 'number' ? 0 : (resolvedOffset?.crossAxis ?? 0)

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
    >
      {trigger
        ? (
            <PopoverTrigger
              nativeButton={shouldRenderTriggerAsButtonRoot}
              onClick={handleTrigger}
              render={resolvedTriggerElement as React.ReactElement}
            />
          )
        : defaultTriggerElement}
      <PopoverContent
        placement={placement}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        popupClassName="border-none bg-transparent shadow-none"
        popupProps={isolateKeyboardEvents ? { onKeyDown: handlePopupKeyDown } : undefined}
      >
        <div className={cn('w-[400px] min-w-0 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg', popupClassName)}>
          <Tabs
            tabs={tabs}
            activeTab={activeTab}
            blocks={blocks}
            allowStartNodeSelection={canSelectUserInput}
            hasUserInputNode={hasUserInputNode}
            hasTriggerNode={hasTriggerNode}
            onActiveTabChange={handleActiveTabChange}
            filterElem={activeTab === TabsEnum.Snippets
              ? null
              : (
                  <div className="relative m-2" onClick={e => e.stopPropagation()}>
                    {activeTab === TabsEnum.Start && (
                      <SearchBox
                        autoFocus
                        search={searchText}
                        onSearchChange={setSearchText}
                        tags={tags}
                        onTagsChange={setTags}
                        placeholder={searchPlaceholder}
                        inputClassName="grow"
                      />
                    )}
                    {activeTab === TabsEnum.Blocks && (
                      <Input
                        showLeftIcon
                        showClearIcon
                        autoFocus
                        value={searchText}
                        placeholder={searchPlaceholder}
                        onChange={e => setSearchText(e.target.value)}
                        onClear={() => setSearchText('')}
                      />
                    )}
                    {activeTab === TabsEnum.Sources && (
                      <Input
                        showLeftIcon
                        showClearIcon
                        autoFocus
                        value={searchText}
                        placeholder={searchPlaceholder}
                        onChange={e => setSearchText(e.target.value)}
                        onClear={() => setSearchText('')}
                      />
                    )}
                    {activeTab === TabsEnum.Tools && (
                      <SearchBox
                        autoFocus
                        search={searchText}
                        onSearchChange={setSearchText}
                        tags={tags}
                        onTagsChange={setTags}
                        placeholder={t('searchTools', { ns: 'plugin' })!}
                        inputClassName="grow"
                      />
                    )}
                  </div>
                )}
            onSelect={handleSelect}
            searchText={filterSearchText}
            tags={tags}
            availableBlocksTypes={availableBlocksTypes}
            noBlocks={noBlocks}
            dataSources={dataSources}
            noTools={noTools}
            onTagsChange={setTags}
            forceShowStartContent={forceShowStartContent}
            snippetsElem={disableSnippetsTab
              ? undefined
              : (
                  <Snippets
                    loading={snippetsLoading}
                    searchText={searchText}
                    onSearchTextChange={setSearchText}
                    insertPayload={snippetInsertPayload}
                    onInserted={() => handleOpenChange(false)}
                  />
                )}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default memo(NodeSelector)
