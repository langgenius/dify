'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ExploreContext from '@/context/explore-context'
import Sidebar from '@/app/components/explore/sidebar'
import { useAppContext } from '@/context/app-context'
import { fetchMembers } from '@/service/common'
import type { InstalledApp } from '@/models/explore'

export type IExploreProps = {
  children: React.ReactNode
}

const Explore: FC<IExploreProps> = ({
  children,
}) => {
  const { t } = useTranslation()
  const [controlUpdateInstalledApps, setControlUpdateInstalledApps] = useState(0)
  const { userProfile } = useAppContext()
  const [hasEditPermission, setHasEditPermission] = useState(false)
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([])

  useEffect(() => {
    document.title = `${t('explore.title')} -  Dify`;
    (async () => {
      const { accounts } = await fetchMembers({ url: '/workspaces/current/members', params: {} })
      if (!accounts)
        return
      const currUser = accounts.find(account => account.id === userProfile.id)
      setHasEditPermission(currUser?.role !== 'normal')
    })()
  }, [])

  return (
    <div className='flex h-full bg-gray-100 border-t border-gray-200 overflow-hidden'>
      <ExploreContext.Provider
        value={
          {
            controlUpdateInstalledApps,
            setControlUpdateInstalledApps,
            hasEditPermission,
            installedApps,
            setInstalledApps,
          }
        }
      >
        <Sidebar controlUpdateInstalledApps={controlUpdateInstalledApps} />
        <div className='grow w-0'>
          {children}
        </div>
      </ExploreContext.Provider>
    </div>
  )
}
export default React.memo(Explore)
