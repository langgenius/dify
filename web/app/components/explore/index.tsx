'use client'
import * as React from 'react'
import Sidebar from '@/app/components/explore/sidebar'

const Explore = ({
  children,
}: {
  children: React.ReactNode
}) => {
  return (
    <div className="flex h-full overflow-hidden border-t border-divider-regular bg-background-body">
      <Sidebar />
      <div className="h-full min-h-0 w-0 grow">
        {children}
      </div>
    </div>
  )
}
export default React.memo(Explore)
