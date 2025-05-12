import React from 'react'
import type { FC } from 'react'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  icons: 'data:,', // prevent browser from using default favicon
}

const Layout: FC<{
  children: React.ReactNode
}> = ({ children }) => {
  return (
    <div className="h-full min-w-[300px] pb-[env(safe-area-inset-bottom)]">
      {children}
    </div>
  )
}

export default Layout
