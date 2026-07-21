import type { Placement } from '@langgenius/dify-ui/popover'
import type {
  CSSProperties,
  KeyboardEvent,
  MouseEventHandler,
  ReactElement,
  ReactNode,
} from 'react'
import type {
  CommonNodeType,
  NodeDefault,
  OnNodeAdd,
  OnSelectBlock,
  ToolWithProvider,
} from '../types'
import type { TabType } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import useNodes from '@/app/components/workflow/store/workflow/use-nodes'
import { FlowType } from '@/types/common'
import { useStore } from '../store'
import { BlockEnum, isTriggerNode } from '../types'
import { useTabs } from './hooks'
import { BlockSelectorPanels } from './tabs'

export type BlockSelectorProps = {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSelect: OnSelectBlock
  trigger?: (open: boolean) => ReactElement
  triggerTooltip?: ReactNode
  placement?: Placement
  sideOffset?: number
  alignOffset?: number
  triggerStyle?: CSSProperties
  triggerClassName?: (open: boolean) => string
  triggerAriaLabel?: string
  popupClassName?: string
  availableBlocksTypes?: BlockEnum[]
  disabled?: boolean
  blocks?: NodeDefault[]
  dataSources?: ToolWithProvider[]
  noBlocks?: boolean
  noTools?: boolean
  standalonePanel?: TabType
  showStartTab?: boolean
  defaultActiveTab?: TabType
  ignoreNodeIds?: string[]
  forceEnableStartTab?: boolean // Force enabling Start tab regardless of existing trigger/user input nodes (e.g., when changing Start node type).
  allowUserInputSelection?: boolean // Override user-input availability; default logic blocks it when triggers exist.
  snippetInsertPayload?: Parameters<OnNodeAdd>[1]
  isolateKeyboardEvents?: boolean
}
function BlockSelector({
  open: openFromProps,
  onOpenChange,
  onSelect,
  trigger,
  triggerTooltip,
  placement = 'right',
  sideOffset,
  alignOffset,
  triggerClassName,
  triggerAriaLabel,
  triggerStyle,
  popupClassName,
  availableBlocksTypes,
  disabled,
  blocks,
  dataSources,
  noBlocks = false,
  noTools = false,
  standalonePanel,
  showStartTab = false,
  defaultActiveTab,
  ignoreNodeIds = [],
  forceEnableStartTab = false,
  allowUserInputSelection,
  snippetInsertPayload,
  isolateKeyboardEvents = false,
}: BlockSelectorProps) {
  const { t } = useTranslation()
  const [localOpen, setLocalOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const open = openFromProps === undefined ? localOpen : openFromProps
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (newOpen && disabled) return

      setLocalOpen(newOpen)
      if (onOpenChange) onOpenChange(newOpen)
    },
    [disabled, onOpenChange],
  )

  const handleTrigger = useCallback<MouseEventHandler<HTMLElement>>((e) => {
    e.stopPropagation()
  }, [])
  const handlePopupClick = useCallback<MouseEventHandler<HTMLDivElement>>((event) => {
    event.stopPropagation()
  }, [])

  const handleSelect = useCallback<OnSelectBlock>(
    (type, pluginDefaultValue) => {
      if (disabled) return
      handleOpenChange(false)
      onSelect(type, pluginDefaultValue)
    },
    [disabled, handleOpenChange, onSelect],
  )

  const handlePopupKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (isolateKeyboardEvents) event.stopPropagation()
    },
    [isolateKeyboardEvents],
  )

  const triggerControl = trigger ? (
    <PopoverTrigger
      aria-label={triggerAriaLabel}
      disabled={disabled}
      render={trigger(open)}
      onClick={handleTrigger}
    />
  ) : (
    <PopoverTrigger
      aria-label={t(($) => $['common.addBlock'], { ns: 'workflow' })}
      disabled={disabled}
      render={
        <Button
          variant="primary"
          size="small"
          className={cn('z-10 size-4 rounded-full p-0', triggerClassName?.(open))}
          style={triggerStyle}
        />
      }
      onClick={handleTrigger}
    >
      <span aria-hidden className="i-custom-vender-line-general-plus-02 size-2.5" />
    </PopoverTrigger>
  )
  const triggerWithTooltip = triggerTooltip ? (
    <Tooltip>
      <TooltipTrigger render={triggerControl} />
      <TooltipContent sideOffset={4}>{triggerTooltip}</TooltipContent>
    </Tooltip>
  ) : (
    triggerControl
  )

  return (
    <Popover modal="trap-focus" open={open} onOpenChange={handleOpenChange}>
      {triggerWithTooltip}
      <PopoverContent
        placement={placement}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        positionerProps={{ positionMethod: 'fixed' }}
        popupClassName="border-none bg-transparent shadow-none"
        popupProps={{
          initialFocus: searchInputRef,
          onClick: handlePopupClick,
          ...(isolateKeyboardEvents ? { onKeyDown: handlePopupKeyDown } : {}),
        }}
      >
        <PopoverTitle className="sr-only">
          {t(($) => $['common.addBlock'], { ns: 'workflow' })}
        </PopoverTitle>
        <div
          className={cn(
            'w-100 min-w-0 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg',
            popupClassName,
          )}
        >
          <BlockSelectorContent
            standalonePanel={standalonePanel}
            searchInputRef={searchInputRef}
            blocks={blocks}
            onSelect={handleSelect}
            onRequestClose={() => handleOpenChange(false)}
            availableBlocksTypes={availableBlocksTypes}
            dataSources={dataSources}
            noBlocks={noBlocks}
            noTools={noTools}
            showStartTab={showStartTab}
            defaultActiveTab={defaultActiveTab}
            ignoreNodeIds={ignoreNodeIds}
            forceEnableStartTab={forceEnableStartTab}
            allowUserInputSelection={allowUserInputSelection}
            snippetInsertPayload={snippetInsertPayload}
          />
        </div>
        <PopoverClose className="sr-only" tabIndex={-1}>
          {t(($) => $['operation.close'], { ns: 'common' })}
        </PopoverClose>
      </PopoverContent>
    </Popover>
  )
}

type BlockSelectorContentProps = Pick<
  BlockSelectorProps,
  | 'allowUserInputSelection'
  | 'availableBlocksTypes'
  | 'blocks'
  | 'dataSources'
  | 'defaultActiveTab'
  | 'forceEnableStartTab'
  | 'ignoreNodeIds'
  | 'noBlocks'
  | 'noTools'
  | 'showStartTab'
  | 'snippetInsertPayload'
  | 'standalonePanel'
> & {
  onSelect: OnSelectBlock
  onRequestClose: () => void
  searchInputRef: React.RefObject<HTMLInputElement | null>
}

function BlockSelectorContent({
  allowUserInputSelection,
  availableBlocksTypes,
  blocks: blocksFromProps,
  dataSources: dataSourcesFromProps,
  defaultActiveTab,
  forceEnableStartTab = false,
  ignoreNodeIds = [],
  noBlocks = false,
  noTools = false,
  onRequestClose,
  onSelect,
  searchInputRef,
  showStartTab = false,
  snippetInsertPayload,
  standalonePanel,
}: BlockSelectorContentProps) {
  const nodes = useNodes()
  const flowType = useHooksStore((state) => state.configsMap?.flowType)
  const availableNodesMetaData = useHooksStore((state) => state.availableNodesMetaData)
  const fallbackDataSources = useStore((state) => state.dataSourceList)
  const blocks = useMemo(() => {
    if (blocksFromProps) return blocksFromProps

    return (availableNodesMetaData?.nodes ?? []).filter((block) => {
      return ![
        BlockEnum.Start,
        BlockEnum.StartPlaceholder,
        BlockEnum.DataSource,
        BlockEnum.Tool,
        BlockEnum.IterationStart,
        BlockEnum.LoopStart,
        BlockEnum.DataSourceEmpty,
      ].includes(block.metaData.type)
    })
  }, [availableNodesMetaData?.nodes, blocksFromProps])
  const dataSources = dataSourcesFromProps ?? fallbackDataSources ?? []
  const filteredNodes = useMemo(() => {
    if (!ignoreNodeIds.length) return nodes
    const ignoredNodeIds = new Set(ignoreNodeIds)
    return nodes.filter((node) => !ignoredNodeIds.has(node.id))
  }, [ignoreNodeIds, nodes])
  const { hasTriggerNode, hasUserInputNode, hasStartPlaceholderNode } = useMemo(() => {
    const result = {
      hasTriggerNode: false,
      hasUserInputNode: false,
      hasStartPlaceholderNode: false,
    }

    for (const node of filteredNodes) {
      const nodeType = (node.data as CommonNodeType | undefined)?.type
      if (!nodeType) continue
      if (nodeType === BlockEnum.Start) result.hasUserInputNode = true
      if (nodeType === BlockEnum.StartPlaceholder) result.hasStartPlaceholderNode = true
      if (isTriggerNode(nodeType)) result.hasTriggerNode = true
      if (result.hasTriggerNode && result.hasUserInputNode && result.hasStartPlaceholderNode) break
    }

    return result
  }, [filteredNodes])
  const disableStartTab = flowType === FlowType.snippet
  const { initialTab, tabs } = useTabs({
    noBlocks,
    noSources: !dataSources.length,
    noTools,
    noSnippets: flowType === FlowType.snippet,
    noStart: !showStartTab,
    defaultActiveTab,
    hasStartPlaceholderNode,
    disableStartTab,
    forceEnableStartTab,
  })
  const allowStartNodeSelection = allowUserInputSelection ?? (!hasUserInputNode && !hasTriggerNode)

  return (
    <BlockSelectorPanels
      tabs={tabs}
      defaultTab={initialTab}
      standalonePanel={standalonePanel}
      searchInputRef={searchInputRef}
      blocks={blocks}
      allowStartNodeSelection={allowStartNodeSelection}
      hasUserInputNode={hasUserInputNode}
      hasTriggerNode={hasTriggerNode}
      onSelect={onSelect}
      onRequestClose={onRequestClose}
      availableBlocksTypes={availableBlocksTypes}
      dataSources={dataSources}
      snippetInsertPayload={snippetInsertPayload}
    />
  )
}

export default memo(BlockSelector)
