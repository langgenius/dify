import type { FC } from 'react'
import { useState } from 'react'
import cn from '@/utils/classnames'
import {
  RiMoreFill,
} from '@remixicon/react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import ActionButton from '@/app/components/base/action-button'
import type { ActionButtonProps } from '@/app/components/base/action-button'

export type Item = {
  value: string | number
  text: string | React.JSX.Element
}
type DropdownProps = {
  items: Item[]
  secondItems?: Item[]
  onSelect: (item: Item) => void
  renderTrigger?: (open: boolean) => React.ReactNode
  triggerProps?: ActionButtonProps
  popupClassName?: string
  itemClassName?: string
  secondItemClassName?: string
}
const Dropdown: FC<DropdownProps> = ({
  items,
  onSelect,
  secondItems,
  renderTrigger,
  triggerProps,
  popupClassName,
  itemClassName,
  secondItemClassName,
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
              <ActionButton
                {...triggerProps}
                className={cn(
                  open && 'bg-divider-regular',
                  triggerProps?.className,
                )}
              >
                <RiMoreFill className='h-4 w-4 text-text-tertiary' />
              </ActionButton>
            )
        }
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className={popupClassName}>
        <div className='rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg text-sm text-text-secondary shadow-lg'>
          {
            !!items.length && (
              <div className='p-1'>
                {
                  items.map(item => (
                    <div
                      key={item.value}
                      className={cn(
                        'flex h-8 cursor-pointer items-center rounded-lg px-3 hover:bg-components-panel-on-panel-item-bg-hover',
                        itemClassName,
                      )}
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
              <div className='h-px bg-divider-regular' />
            )
          }
          {
            !!secondItems?.length && (
              <div className='p-1'>
                {
                  secondItems.map(item => (
                    <div
                      key={item.value}
                      className={cn(
                        'flex h-8 cursor-pointer items-center rounded-lg px-3 hover:bg-components-panel-on-panel-item-bg-hover',
                        secondItemClassName,
                      )}
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
