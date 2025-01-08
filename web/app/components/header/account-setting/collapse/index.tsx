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
      <div className='flex items-center justify-between leading-[18px] px-3 py-2 text-xs font-medium text-text-secondary cursor-pointer' onClick={toggle}>
        {title}
        {
          open
            ? <ChevronDownIcon className='w-3 h-3 text-components-button-tertiary-text' />
            : <ChevronRightIcon className='w-3 h-3 text-components-button-tertiary-text' />
        }
      </div>
      {
        open && (
          <div className='py-1 mb-1 mx-1 border-t border-divider-subtle rounded-lg bg-components-panel-on-panel-item-bg'>
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
