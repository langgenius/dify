import React from 'react'
import type { FC } from 'react'
import type { Metadata } from 'next'
import { SharePageContextProvider } from '@/context/share-page-context'

export const metadata: Metadata = {
  icons: 'data:,', // prevent browser from using default favicon
}

const Layout: FC<{
  children: React.ReactNode
}> = ({ children }) => {
  return (
    <div className="min-w-[300px] h-full pb-[env(safe-area-inset-bottom)]">
      <SharePageContextProvider>
        {children}
      </SharePageContextProvider>
    </div>
  )
}

export default Layout
