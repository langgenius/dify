import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { useState } from 'react'
import { cn } from '@/utils/classnames'

export type IItem = {
  key: string
  name: string
}
type ICollapse = {
  title: string | undefined
  items: IItem[]
  renderItem: (item: IItem) => React.ReactNode
  onSelect?: (item: IItem) => void
  wrapperClassName?: string
}
const Collapse = ({
  title,
  items,
  renderItem,
  onSelect,
  wrapperClassName,
}: ICollapse) => {
  const [open, setOpen] = useState(false)

  const toggle = () => setOpen(!open)

  return (
    <div className={cn('overflow-hidden rounded-xl bg-background-section-burn', wrapperClassName)}>
      <div className="flex cursor-pointer items-center justify-between px-3 py-2 text-xs font-medium leading-[18px] text-text-secondary" onClick={toggle}>
        {title}
        {
          open
            ? <ChevronDownIcon className="h-3 w-3 text-components-button-tertiary-text" />
            : <ChevronRightIcon className="h-3 w-3 text-components-button-tertiary-text" />
        }
      </div>
      {
        open && (
          <div className="mx-1 mb-1 rounded-lg border-t border-divider-subtle bg-components-panel-on-panel-item-bg py-1">
            {
              items.map(item => (
                <div key={item.key} onClick={() => onSelect?.(item)}>
                  {renderItem(item)}
                </div>
              ))
            }
          </div>
        )
      }
    </div>
  )
}

export default Collapse
