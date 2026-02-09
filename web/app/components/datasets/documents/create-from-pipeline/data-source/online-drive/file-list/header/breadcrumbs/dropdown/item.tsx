import * as React from 'react'
import { useCallback } from 'react'

type ItemProps = {
  name: string
  index: number
  onBreadcrumbClick: (index: number) => void
}

const Item = ({
  name,
  index,
  onBreadcrumbClick,
}: ItemProps) => {
  const handleClick = useCallback(() => {
    onBreadcrumbClick(index)
  }, [index, onBreadcrumbClick])

  return (
    <div
      className="rounded-lg px-3 py-1.5 text-text-secondary system-md-regular hover:bg-state-base-hover"
      onClick={handleClick}
    >
      {name}
    </div>
  )
}

export default React.memo(Item)
