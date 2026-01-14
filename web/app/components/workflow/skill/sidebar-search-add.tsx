import type { FC } from 'react'
import * as React from 'react'

const SidebarSearchAdd: FC = () => {
  return (
    <div
      className="flex items-center gap-2"
      data-component="sidebar-search-add"
    >
      <div className="h-8 flex-1 rounded-md bg-gray-100" />
      <div className="h-8 w-8 rounded-md bg-gray-100" />
    </div>
  )
}

export default React.memo(SidebarSearchAdd)
