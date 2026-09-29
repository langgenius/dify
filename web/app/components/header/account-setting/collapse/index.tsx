import { cn } from '@langgenius/dify-ui/cn'
import { useState } from 'react'

export type IItem = {
  key: string
  name: string
}
type ICollapse<T extends IItem> = {
  title: string | undefined
  items: T[]
  renderItem: (item: T) => React.ReactNode
  onSelect?: (item: T) => void
  wrapperClassName?: string
}
const Collapse = <T extends IItem>({
  title,
  items,
  renderItem,
  onSelect,
  wrapperClassName,
}: ICollapse<T>) => {
  const [open, setOpen] = useState(false)

  const toggle = () => setOpen(!open)

  return (
    <div className={cn('overflow-hidden rounded-xl bg-background-section-burn', wrapperClassName)}>
      <button
        type="button"
        className="flex w-full cursor-pointer items-center justify-between border-none bg-transparent px-3 py-2 text-left text-xs leading-4.5 font-medium text-text-secondary focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
        onClick={toggle}
      >
        {title}
        <span
          aria-hidden
          className={`${open ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'} size-3 text-components-button-tertiary-text`}
        />
      </button>
      {open && (
        <div className="mx-1 mb-1 rounded-lg border-t border-divider-subtle bg-components-panel-on-panel-item-bg py-1">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className="block w-full border-none bg-transparent p-0 text-left"
              onClick={() => onSelect?.(item)}
            >
              {renderItem(item)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default Collapse
