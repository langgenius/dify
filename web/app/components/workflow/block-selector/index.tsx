import type {
  FC,
  MouseEventHandler,
} from 'react'
import {
  memo,
  useCallback,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import type {
  OffsetOptions,
  Placement,
} from '@floating-ui/react'
import type { BlockEnum, OnSelectBlock } from '../types'
import Tabs from './tabs'
import { TabsEnum } from './types'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Input from '@/app/components/base/input'
import {
  Plus02,
} from '@/app/components/base/icons/src/vender/line/general'
import classNames from '@/utils/classnames'

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
}) => {
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState('')
  const [localOpen, setLocalOpen] = useState(false)
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
  const handleSelect = useCallback<OnSelectBlock>((type, toolDefaultValue) => {
    handleOpenChange(false)
    onSelect(type, toolDefaultValue)
  }, [handleOpenChange, onSelect])

  const [activeTab, setActiveTab] = useState(noBlocks ? TabsEnum.Tools : TabsEnum.Blocks)
  const handleActiveTabChange = useCallback((newActiveTab: TabsEnum) => {
    setActiveTab(newActiveTab)
  }, [])
  const searchPlaceholder = useMemo(() => {
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
                  flex items-center justify-center 
                  w-4 h-4 rounded-full bg-components-button-primary-bg text-text-primary-on-surface hover:bg-components-button-primary-bg-hover cursor-pointer z-10
                  ${triggerClassName?.(open)}
                `}
                style={triggerStyle}
              >
                <Plus02 className='w-2.5 h-2.5' />
              </div>
            )
        }
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[1000]'>
        <div className={
          classNames(`rounded-lg border-[0.5px] backdrop-blur-[5px]
          border-components-panel-border bg-components-panel-bg-blur shadow-lg`, popupClassName)}>
          <div className='p-2 pb-1' onClick={e => e.stopPropagation()}>
            <Input
              showLeftIcon
              showClearIcon
              autoFocus
              value={searchText}
              placeholder={searchPlaceholder}
              onChange={e => setSearchText(e.target.value)}
              onClear={() => setSearchText('')}
            />
          </div>
          <Tabs
            activeTab={activeTab}
            onActiveTabChange={handleActiveTabChange}
            onSelect={handleSelect}
            searchText={searchText}
            availableBlocksTypes={availableBlocksTypes}
            noBlocks={noBlocks}
          />
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(NodeSelector)
