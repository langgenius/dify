import type {
  FC,
  MouseEventHandler,
} from 'react'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import type {
  OffsetOptions,
  Placement,
} from '@floating-ui/react'
import type { BlockEnum } from '../types'
import Tabs from './tabs'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import {
  Plus02,
  SearchLg,
} from '@/app/components/base/icons/src/vender/line/general'

type NodeSelectorProps = {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSelect: (type: BlockEnum) => void
  trigger?: (open: boolean) => React.ReactNode
  placement?: Placement
  offset?: OffsetOptions
  triggerStyle?: React.CSSProperties
  triggerClassName?: (open: boolean) => string
  popupClassName?: string
  asChild?: boolean
}
const NodeSelector: FC<NodeSelectorProps> = ({
  open: openFromProps,
  onOpenChange,
  onSelect,
  trigger,
  placement = 'right',
  offset = 6,
  triggerClassName,
  triggerStyle,
  popupClassName,
  asChild,
}) => {
  const [localOpen, setLocalOpen] = useState(false)
  const open = openFromProps === undefined ? localOpen : openFromProps
  const handleOpenChange = useCallback((newOpen: boolean) => {
    setLocalOpen(newOpen)

    if (onOpenChange)
      onOpenChange(newOpen)
  }, [onOpenChange])
  const handleTrigger = useCallback<MouseEventHandler<HTMLDivElement>>((e) => {
    e.stopPropagation()
    handleOpenChange(!open)
  }, [open, handleOpenChange])

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
        <div className={`w-[256px] rounded-lg border-[0.5px] border-gray-200 bg-white shadow-lg ${popupClassName}`}>
          <div className='px-2 pt-2'>
            <div className='flex items-center px-2 rounded-lg bg-gray-100'>
              <SearchLg className='shrink-0 ml-[1px] mr-[5px] w-3.5 h-3.5 text-gray-400' />
              <input
                className='grow px-0.5 py-[7px] text-[13px] bg-transparent appearance-none outline-none'
                placeholder='Search block'
              />
            </div>
          </div>
          <Tabs onSelect={onSelect} />
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(NodeSelector)
