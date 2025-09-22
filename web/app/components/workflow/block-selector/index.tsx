import {
  useMemo,
} from 'react'
import type { NodeSelectorProps } from './main'
import NodeSelector from './main'
import { useHooksStore } from '@/app/components/workflow/hooks-store/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { useStore } from '../store'

const NodeSelectorWrapper = (props: NodeSelectorProps) => {
  const availableNodesMetaData = useHooksStore(s => s.availableNodesMetaData)
  const dataSourceList = useStore(s => s.dataSourceList)

<<<<<<< HEAD
  const blocks = useMemo(() => {
    const result = availableNodesMetaData?.nodes || []
=======
type NodeSelectorProps = {
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
  noBlocks?: boolean
  showStartTab?: boolean
  defaultActiveTab?: TabsEnum
  forceShowStartContent?: boolean
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
  noBlocks = false,
  showStartTab = false,
  defaultActiveTab,
  forceShowStartContent = false,
}) => {
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [localOpen, setLocalOpen] = useState(false)
  const open = openFromProps === undefined ? localOpen : openFromProps
  const handleOpenChange = useCallback((newOpen: boolean) => {
    setLocalOpen(newOpen)
>>>>>>> feat/trigger

    return result.filter((block) => {
      if (block.metaData.type === BlockEnum.Start)
        return false

<<<<<<< HEAD
      if (block.metaData.type === BlockEnum.DataSource)
        return false

      if (block.metaData.type === BlockEnum.Tool)
        return false

      if (block.metaData.type === BlockEnum.IterationStart)
        return false

      if (block.metaData.type === BlockEnum.LoopStart)
        return false

      if (block.metaData.type === BlockEnum.DataSourceEmpty)
        return false

      return true
    })
  }, [availableNodesMetaData?.nodes])

  return (
    <NodeSelector
      {...props}
      blocks={blocks}
      dataSources={dataSourceList || []}
    />
=======
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

  const [activeTab, setActiveTab] = useState(
    defaultActiveTab || (noBlocks ? TabsEnum.Tools : TabsEnum.Blocks),
  )
  const handleActiveTabChange = useCallback((newActiveTab: TabsEnum) => {
    setActiveTab(newActiveTab)
  }, [])
  const searchPlaceholder = useMemo(() => {
    if (activeTab === TabsEnum.Start)
      return t('workflow.tabs.searchTrigger')
    if (activeTab === TabsEnum.Blocks)
      return t('workflow.tabs.searchBlock')
    if (activeTab === TabsEnum.Tools)
      return t('workflow.tabs.searchTool')
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
                <Plus02 className='h-2.5 w-2.5' />
              </div>
            )
        }
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[1000]'>
        <div className={`rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg ${popupClassName}`}>
          <Tabs
            activeTab={activeTab}
            onActiveTabChange={handleActiveTabChange}
            filterElem={
              <div className='relative m-2' onClick={e => e.stopPropagation()}>
                {activeTab === TabsEnum.Start && (
                  <SearchBox
                    search={searchText}
                    onSearchChange={setSearchText}
                    tags={tags}
                    onTagsChange={setTags}
                    size='small'
                    placeholder={searchPlaceholder}
                    inputClassName='grow'
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
                {activeTab === TabsEnum.Tools && (
                  <SearchBox
                    search={searchText}
                    onSearchChange={setSearchText}
                    tags={tags}
                    onTagsChange={setTags}
                    size='small'
                    placeholder={searchPlaceholder}
                    inputClassName='grow'
                  />
                )}
              </div>
            }
            onSelect={handleSelect}
            searchText={searchText}
            tags={tags}
            availableBlocksTypes={availableBlocksTypes}
            noBlocks={noBlocks}
            showStartTab={showStartTab}
            forceShowStartContent={forceShowStartContent}
          />
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
>>>>>>> feat/trigger
  )
}

export default NodeSelectorWrapper
