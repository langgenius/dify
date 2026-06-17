'use client'
import * as React from 'react'
import Sidebar from '@/app/components/explore/sidebar'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'

const Explore = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  return (
    <div className="flex h-full overflow-hidden border-t border-divider-regular bg-background-body">
      {isMobile && <Sidebar />}
      <div className="h-full min-h-0 w-0 grow">
        {children}
      </div>
    </div>
  )
}
export default React.memo(Explore)
