import type { FC, PropsWithChildren } from 'react'
import * as React from 'react'

type SidebarProps = PropsWithChildren

const Sidebar: FC<SidebarProps> = ({ children }) => {
  return (
    <aside
      className="flex w-[320px] shrink-0 flex-col gap-px overflow-hidden rounded-[10px] border border-components-panel-border-subtle bg-components-panel-bg"
      data-component="sidebar"
    >
      {children}
    </aside>
  )
}

export default React.memo(Sidebar)
