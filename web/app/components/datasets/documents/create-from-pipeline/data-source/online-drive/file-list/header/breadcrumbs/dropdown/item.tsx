import { DropdownMenuItem } from '@langgenius/dify-ui/dropdown-menu'
import * as React from 'react'

type ItemProps = {
  name: string
  index: number
  onBreadcrumbClick: (index: number) => void
}

const Item = ({ name, index, onBreadcrumbClick }: ItemProps) => {
  return (
    <DropdownMenuItem
      className="rounded-lg px-3 py-1.5 system-md-regular text-text-secondary hover:bg-state-base-hover"
      onClick={() => onBreadcrumbClick(index)}
    >
      {name}
    </DropdownMenuItem>
  )
}

export default React.memo(Item)
