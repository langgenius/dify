import type {
  OffsetOptions,
  Placement,
} from '@floating-ui/react'
import type {
  FC,
  MouseEventHandler,
} from 'react'
import type {
  CommonNodeType,
  NodeDefault,
  OnSelectBlock,
  ToolWithProvider,
} from '../types'
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
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
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
    setLocalOpen(newOpen)

    if (!newOpen)
      setSearchText('')

    if (onOpenChange)
      onOpenChange(newOpen)
  }, [onOpenChange])
  const handleTrigger = useCallback<MouseEventHandler<HTMLDivElement>>((e) => {
    if (disabled)
      return
    e.stopPropagation()
    handleOpenChange(!open)
  }, [handleOpenChange, open, disabled])

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

  return (
    <PortalToFollowElem
      placement={placement}
      offset={offset}
      open={open}
      onOpenChange={handleOpenChange}
    >
      <PortalToFollowElemTrigger
        asChild={asChild}
        onClick={handleTrigger}
        className={triggerInnerClassName}
      >
        {
          trigger
            ? trigger(open)
            : (
                <div
                  className={`
                  z-10 flex h-4
                  w-4 cursor-pointer items-center justify-center rounded-full bg-components-button-primary-bg text-text-primary-on-surface hover:bg-components-button-primary-bg-hover
                  ${triggerClassName?.(open)}
                `}
                  style={triggerStyle}
                >
                  <Plus02 className="h-2.5 w-2.5" />
                </div>
              )
        }
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[1000]">
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
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(NodeSelector)
