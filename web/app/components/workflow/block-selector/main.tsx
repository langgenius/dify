import type {
  OffsetOptions,
  Placement,
} from '@floating-ui/react'
import type {
  FC,
  MouseEventHandler,
  MouseEvent as ReactMouseEvent,
} from 'react'
import type {
  CommonNodeType,
  NodeDefault,
  OnSelectBlock,
  ToolWithProvider,
} from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import * as React from 'react'
import {
  memo,
  useCallback,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  Plus02,
} from '@/app/components/base/icons/src/vender/line/general'
import Input from '@/app/components/base/input'
import SearchBox from '@/app/components/plugins/marketplace/search-box'
import useNodes from '@/app/components/workflow/store/workflow/use-nodes'
import { BlockEnum, isTriggerNode } from '../types'
import { useTabs } from './hooks'
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
  popupClassName?: string
  asChild?: boolean
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
}
const NodeSelector: FC<NodeSelectorProps> = ({
  open: openFromProps,
  onOpenChange,
  onSelect,
  trigger,
  placement = 'right',
  offset = 6,
  triggerClassName,
  triggerInnerClassName,
  triggerStyle,
  popupClassName,
  asChild,
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
}) => {
  const { t } = useTranslation()
  const nodes = useNodes()
  const [searchText, setSearchText] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [localOpen, setLocalOpen] = useState(false)
  // Exclude nodes explicitly ignored (such as the node currently being edited) when checking canvas state.
  const filteredNodes = useMemo(() => {
    if (!ignoreNodeIds.length)
      return nodes
    const ignoreSet = new Set(ignoreNodeIds)
    return nodes.filter(node => !ignoreSet.has(node.id))
  }, [nodes, ignoreNodeIds])

  const { hasTriggerNode, hasUserInputNode } = useMemo(() => {
    const result = {
      hasTriggerNode: false,
      hasUserInputNode: false,
    }
    for (const node of filteredNodes) {
      const nodeType = (node.data as CommonNodeType | undefined)?.type
      if (!nodeType)
        continue
      if (nodeType === BlockEnum.Start)
        result.hasUserInputNode = true
      if (isTriggerNode(nodeType))
        result.hasTriggerNode = true
      if (result.hasTriggerNode && result.hasUserInputNode)
        break
    }
    return result
  }, [filteredNodes])
  // Default rule: user input option is only available when no Start node nor Trigger node exists on canvas.
  const defaultAllowUserInputSelection = !hasUserInputNode && !hasTriggerNode
  const canSelectUserInput = allowUserInputSelection ?? defaultAllowUserInputSelection
  const open = openFromProps === undefined ? localOpen : openFromProps
  const handleOpenChange = useCallback((newOpen: boolean) => {
    if (disabled)
      return

    setLocalOpen(newOpen)

    if (!newOpen)
      setSearchText('')

    if (onOpenChange)
      onOpenChange(newOpen)
  }, [disabled, onOpenChange])
  const handleTrigger = useCallback<MouseEventHandler<HTMLElement>>((e) => {
    e.stopPropagation()
  }, [])

  const handleSelect = useCallback<OnSelectBlock>((type, pluginDefaultValue) => {
    handleOpenChange(false)
    onSelect(type, pluginDefaultValue)
  }, [handleOpenChange, onSelect])

  const {
    activeTab,
    setActiveTab,
    tabs,
  } = useTabs({
    noBlocks,
    noSources: !dataSources.length,
    noTools,
    noStart: !showStartTab,
    defaultActiveTab,
    hasUserInputNode,
    forceEnableStartTab,
  })

  const handleActiveTabChange = useCallback((newActiveTab: TabsEnum) => {
    setActiveTab(newActiveTab)
  }, [setActiveTab])

  const searchPlaceholder = useMemo(() => {
    if (activeTab === TabsEnum.Start)
      return t('tabs.searchTrigger', { ns: 'workflow' })

    if (activeTab === TabsEnum.Blocks)
      return t('tabs.searchBlock', { ns: 'workflow' })

    if (activeTab === TabsEnum.Tools)
      return t('tabs.searchTool', { ns: 'workflow' })

    if (activeTab === TabsEnum.Sources)
      return t('tabs.searchDataSource', { ns: 'workflow' })
    return ''
  }, [activeTab, t])

  const defaultTriggerElement = (
    <PopoverTrigger
      aria-label={t('common.addBlock', { ns: 'workflow' })}
      className={cn(
        'z-10 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border-0 bg-components-button-primary-bg p-0 text-text-primary-on-surface hover:bg-components-button-primary-bg-hover focus-visible:ring-1 focus-visible:ring-components-input-border-hover focus-visible:outline-hidden',
        triggerClassName?.(open),
      )}
      style={triggerStyle}
      onClick={handleTrigger}
    >
      <Plus02 aria-hidden className="h-2.5 w-2.5" />
    </PopoverTrigger>
  )
  const triggerElement = trigger?.(open)
  const shouldRenderTriggerElementAsRoot = React.isValidElement(triggerElement)
    && (asChild || triggerElement.type === 'button')
  const triggerElementProps = React.isValidElement(triggerElement)
    ? (triggerElement.props as {
        onClick?: MouseEventHandler<HTMLElement>
      })
    : null
  const resolvedTriggerElement = shouldRenderTriggerElementAsRoot
    ? React.cloneElement(
        triggerElement as React.ReactElement<{
          onClick?: MouseEventHandler<HTMLElement>
        }>,
        {
          onClick: (e: ReactMouseEvent<HTMLElement>) => {
            handleTrigger(e)
            if (typeof triggerElementProps?.onClick === 'function')
              triggerElementProps.onClick(e)
          },
        },
      )
    : (
        <div className={triggerInnerClassName} onClick={handleTrigger}>
          {triggerElement}
        </div>
      )
  const resolvedOffset = typeof offset === 'number' || typeof offset === 'function' ? undefined : offset
  const sideOffset = typeof offset === 'number' ? offset : (resolvedOffset?.mainAxis ?? 0)
  const alignOffset = typeof offset === 'number' ? 0 : (resolvedOffset?.crossAxis ?? 0)
  const nativeButton = shouldRenderTriggerElementAsRoot
    && (typeof triggerElement.type !== 'string' || triggerElement.type === 'button')

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
    >
      {trigger
        ? <PopoverTrigger nativeButton={nativeButton} render={resolvedTriggerElement as React.ReactElement} />
        : defaultTriggerElement}
      <PopoverContent
        placement={placement}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        popupClassName="border-none bg-transparent shadow-none"
      >
        <div className={`rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg ${popupClassName}`}>
          <Tabs
            tabs={tabs}
            activeTab={activeTab}
            blocks={blocks}
            allowStartNodeSelection={canSelectUserInput}
            onActiveTabChange={handleActiveTabChange}
            filterElem={(
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
            searchText={searchText}
            tags={tags}
            availableBlocksTypes={availableBlocksTypes}
            noBlocks={noBlocks}
            dataSources={dataSources}
            noTools={noTools}
            onTagsChange={setTags}
            forceShowStartContent={forceShowStartContent}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default memo(NodeSelector)
