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
  text: string | JSX.Element
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
                  flex items-center justify-center w-6 h-6 cursor-pointer rounded-md
                  ${open && 'bg-divider-regular'}
                `}
              >
                <RiMoreFill className='w-4 h-4 text-text-tertiary' />
              </div>
            )
        }
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className={popupClassName}>
        <div className='rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg text-sm text-text-secondary'>
          {
            !!items.length && (
              <div className='p-1'>
                {
                  items.map(item => (
                    <div
                      key={item.value}
                      className='flex items-center px-3 h-8 rounded-lg cursor-pointer hover:bg-components-panel-on-panel-item-bg-hover'
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
              <div className='h-[1px] bg-divider-regular' />
            )
          }
          {
            !!secondItems?.length && (
              <div className='p-1'>
                {
                  secondItems.map(item => (
                    <div
                      key={item.value}
                      className='flex items-center px-3 h-8 rounded-lg cursor-pointer hover:bg-components-panel-on-panel-item-bg-hover'
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
