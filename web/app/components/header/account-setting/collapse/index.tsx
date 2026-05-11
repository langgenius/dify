import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { cn } from '@langgenius/dify-ui/cn'
import { useState } from 'react'

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
      <button
        type="button"
        className="flex w-full cursor-pointer items-center justify-between border-none bg-transparent px-3 py-2 text-left text-xs leading-[18px] font-medium text-text-secondary focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
        onClick={toggle}
      >
        {title}
        {
          open
            ? <ChevronDownIcon className="h-3 w-3 text-components-button-tertiary-text" aria-hidden="true" />
            : <ChevronRightIcon className="h-3 w-3 text-components-button-tertiary-text" aria-hidden="true" />
        }
      </button>
      {
        open && (
          <div className="mx-1 mb-1 rounded-lg border-t border-divider-subtle bg-components-panel-on-panel-item-bg py-1">
            {
              items.map(item => (
                <button
                  key={item.key}
                  type="button"
                  className="block w-full border-none bg-transparent p-0 text-left"
                  onClick={() => onSelect?.(item)}
                >
                  {renderItem(item)}
                </button>
              ))
            }
          </div>
        )
      }
    </div>
  )
}

export default Collapse
