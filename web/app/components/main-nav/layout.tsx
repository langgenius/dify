'use client'

import type { ReactNode } from 'react'
import MainNav from './index'

type MainNavLayoutProps = {
  children: ReactNode
}

const MainNavLayout = ({
  children,
}: MainNavLayoutProps) => {
  return (
    <div className="flex h-0 min-h-0 grow overflow-hidden bg-background-body">
      <MainNav />
      <div className="flex min-w-0 grow flex-col overflow-hidden">
        {children}
      </div>
    </div>
  )
}

export default MainNavLayout
