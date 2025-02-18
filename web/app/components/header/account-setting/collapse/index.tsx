import { useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import classNames from '@/utils/classnames'

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
    <div className={classNames('bg-background-section-burn rounded-xl', wrapperClassName)}>
      <div className='text-text-secondary flex cursor-pointer items-center justify-between px-3 py-2 text-xs font-medium leading-[18px]' onClick={toggle}>
        {title}
        {
          open
            ? <ChevronDownIcon className='text-components-button-tertiary-text h-3 w-3' />
            : <ChevronRightIcon className='text-components-button-tertiary-text h-3 w-3' />
        }
      </div>
      {
        open && (
          <div className='border-divider-subtle bg-components-panel-on-panel-item-bg mx-1 mb-1 rounded-lg border-t py-1'>
            {
              items.map(item => (
                <div key={item.key} onClick={() => onSelect && onSelect(item)}>
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
