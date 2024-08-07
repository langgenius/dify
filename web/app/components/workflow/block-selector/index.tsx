import type {
  FC,
  MouseEventHandler,
} from 'react'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import type {
  OffsetOptions,
  Placement,
} from '@floating-ui/react'
import {
  RiSearchLine,
} from '@remixicon/react'
import type { BlockEnum, OnSelectBlock } from '../types'
import Tabs from './tabs'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import {
  Plus02,
} from '@/app/components/base/icons/src/vender/line/general'
import { XCircle } from '@/app/components/base/icons/src/vender/solid/general'

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
                  w-4 h-4 rounded-full bg-primary-600 cursor-pointer z-10
                  ${triggerClassName?.(open)}
                `}
                style={triggerStyle}
              >
                <Plus02 className='w-2.5 h-2.5 text-white' />
              </div>
            )
        }
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[1000]'>
        <div className={`rounded-lg border-[0.5px] border-gray-200 bg-white shadow-lg ${popupClassName}`}>
          <div className='px-2 pt-2'>
            <div
              className='flex items-center px-2 rounded-lg bg-gray-100'
              onClick={e => e.stopPropagation()}
            >
              <RiSearchLine className='shrink-0 ml-[1px] mr-[5px] w-3.5 h-3.5 text-gray-400' />
              <input
                value={searchText}
                className='grow px-0.5 py-[7px] text-[13px] text-gray-700 bg-transparent appearance-none outline-none caret-primary-600 placeholder:text-gray-400'
                placeholder={t('workflow.tabs.searchBlock') || ''}
                onChange={e => setSearchText(e.target.value)}
                autoFocus
              />
              {
                searchText && (
                  <div
                    className='flex items-center justify-center ml-[5px] w-[18px] h-[18px] cursor-pointer'
                    onClick={() => setSearchText('')}
                  >
                    <XCircle className='w-[14px] h-[14px] text-gray-400' />
                  </div>
                )
              }
            </div>
          </div>
          <Tabs
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
