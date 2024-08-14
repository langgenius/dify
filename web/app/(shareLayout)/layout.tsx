import React from 'react'
import type { FC } from 'react'
import GA, { GaType } from '@/app/components/base/ga'

const Layout: FC<{
  children: React.ReactNode
}> = ({ children }) => {
  return (
    <div className="min-w-[300px] h-full pb-[env(safe-area-inset-bottom)]">
      <GA gaType={GaType.webapp} />
      {children}
    </div>
  )
}

export default Layout
