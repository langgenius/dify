import type { FC } from 'react'
import { RiCheckLine } from '@remixicon/react'
import * as React from 'react'

type StatusOption = {
  value: string | number
  name: string
}

type IStatusItemProps = {
  item: StatusOption
  selected: boolean
}

const StatusItem: FC<IStatusItemProps> = ({
  item,
  selected,
}) => {
  return (
    <div className="flex items-center justify-between px-2 py-1.5">
      <span className="system-md-regular">{item.name}</span>
      {selected && <RiCheckLine className="h-4 w-4 text-text-accent" />}
    </div>
  )
}

export default React.memo(StatusItem)
