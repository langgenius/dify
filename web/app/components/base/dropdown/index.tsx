import type { FC } from 'react'
import { useState } from 'react'
import {
  RiMoreFill,
} from '@remixicon/react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

export type Item = {
  value: string | number
  text: string | React.JSX.Element
}
type DropdownProps = {
  items: Item[]
  secondItems?: Item[]
  onSelect: (item: Item) => void
  renderTrigger?: (open: boolean) => React.ReactNode
  popupClassName?: string
}
const Dropdown: FC<DropdownProps> = ({
  items,
  onSelect,
  secondItems,
  renderTrigger,
  popupClassName,
}) => {
  const [open, setOpen] = useState(false)

  const handleSelect = (item: Item) => {
    setOpen(false)
    onSelect(item)
  }

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        {
          renderTrigger
            ? renderTrigger(open)
            : (
              <div
                className={`
                  flex h-6 w-6 cursor-pointer items-center justify-center rounded-md
                  ${open && 'bg-divider-regular'}
                `}
              >
                <RiMoreFill className='text-text-tertiary h-4 w-4' />
              </div>
            )
        }
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className={popupClassName}>
        <div className='border-components-panel-border bg-components-panel-bg text-text-secondary rounded-lg border-[0.5px] text-sm shadow-lg'>
          {
            !!items.length && (
              <div className='p-1'>
                {
                  items.map(item => (
                    <div
                      key={item.value}
                      className='hover:bg-components-panel-on-panel-item-bg-hover flex h-8 cursor-pointer items-center rounded-lg px-3'
                      onClick={() => handleSelect(item)}
                    >
                      {item.text}
                    </div>
                  ))
                }
              </div>
            )
          }
          {
            (!!items.length && !!secondItems?.length) && (
              <div className='bg-divider-regular h-[1px]' />
            )
          }
          {
            !!secondItems?.length && (
              <div className='p-1'>
                {
                  secondItems.map(item => (
                    <div
                      key={item.value}
                      className='hover:bg-components-panel-on-panel-item-bg-hover flex h-8 cursor-pointer items-center rounded-lg px-3'
                      onClick={() => handleSelect(item)}
                    >
                      {item.text}
                    </div>
                  ))
                }
              </div>
            )
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default Dropdown
