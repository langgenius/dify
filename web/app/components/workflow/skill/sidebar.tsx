import type { FC, PropsWithChildren } from 'react'
import * as React from 'react'

type SidebarProps = PropsWithChildren

const Sidebar: FC<SidebarProps> = ({ children }) => {
  return (
    <aside
      className="flex w-[260px] shrink-0 flex-col gap-3 rounded-lg bg-white p-3"
      data-component="sidebar"
    >
      {children}
    </aside>
  )
}

export default React.memo(Sidebar)
