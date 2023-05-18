'use client'
import React, { FC } from 'react'
import ExploreContext from '@/context/explore-context'
import Sidebar from '@/app/components/explore/sidebar'


export interface IExploreProps {
  children: React.ReactNode
}

const Explore: FC<IExploreProps> = ({
  children
}) => {
  const [controlUpdateInstalledApps, setControlUpdateInstalledApps] = React.useState(0)
  return (
    <div className='flex h-full bg-gray-100 border-t border-gray-200'>
      <ExploreContext.Provider
        value={
          {
            controlUpdateInstalledApps,
            setControlUpdateInstalledApps
          }
        }
      >
        <Sidebar controlUpdateInstalledApps={controlUpdateInstalledApps} />
        <div className='grow'>
          {children}
        </div>
      </ExploreContext.Provider>
    </div>
  )
}
export default React.memo(Explore)
