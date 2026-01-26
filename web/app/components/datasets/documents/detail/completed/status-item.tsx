import type { FC } from 'react'
import type { Item } from '@/app/components/base/select'
import * as React from 'react'

type IStatusItemProps = {
  item: Item
  selected: boolean
}

const StatusItem: FC<IStatusItemProps> = ({
  item,
  selected,
}) => {
  return (
    <div className="flex items-center justify-between px-2 py-1.5">
      <span className="system-md-regular">{item.name}</span>
      {selected && <span className="i-ri-check-line h-4 w-4 text-text-accent" />}
    </div>
  )
}

export default React.memo(StatusItem)
