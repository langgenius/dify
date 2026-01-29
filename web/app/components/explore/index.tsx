'use client'
import type { FC } from 'react'
import type { CurrentTryAppParams } from '@/context/explore-context'
import type { InstalledApp } from '@/models/explore'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Sidebar from '@/app/components/explore/sidebar'
import { useAppContext } from '@/context/app-context'
import ExploreContext from '@/context/explore-context'
import useDocumentTitle from '@/hooks/use-document-title'
import { useMembers } from '@/service/use-common'

export type IExploreProps = {
  children: React.ReactNode
}

const Explore: FC<IExploreProps> = ({
  children,
}) => {
  const router = useRouter()
  const [controlUpdateInstalledApps, setControlUpdateInstalledApps] = useState(0)
  const { userProfile, isCurrentWorkspaceDatasetOperator } = useAppContext()
  const [hasEditPermission, setHasEditPermission] = useState(false)
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([])
  const [isFetchingInstalledApps, setIsFetchingInstalledApps] = useState(false)
  const { t } = useTranslation()
  const { data: membersData } = useMembers()

  useDocumentTitle(t('menus.explore', { ns: 'common' }))

  useEffect(() => {
    if (!membersData?.accounts)
      return
    const currUser = membersData.accounts.find(account => account.id === userProfile.id)
    setHasEditPermission(currUser?.role !== 'normal')
  }, [membersData, userProfile.id])

  useEffect(() => {
    if (isCurrentWorkspaceDatasetOperator)
      return router.replace('/datasets')
  }, [isCurrentWorkspaceDatasetOperator])

  const [currentTryAppParams, setCurrentTryAppParams] = useState<CurrentTryAppParams | undefined>(undefined)
  const [isShowTryAppPanel, setIsShowTryAppPanel] = useState(false)
  const setShowTryAppPanel = (showTryAppPanel: boolean, params?: CurrentTryAppParams) => {
    if (showTryAppPanel)
      setCurrentTryAppParams(params)
    else
      setCurrentTryAppParams(undefined)
    setIsShowTryAppPanel(showTryAppPanel)
  }

  return (
    <div className="flex h-full overflow-hidden border-t border-divider-regular bg-background-body">
      <ExploreContext.Provider
        value={
          {
            controlUpdateInstalledApps,
            setControlUpdateInstalledApps,
            hasEditPermission,
            installedApps,
            setInstalledApps,
            isFetchingInstalledApps,
            setIsFetchingInstalledApps,
            currentApp: currentTryAppParams,
            isShowTryAppPanel,
            setShowTryAppPanel,
          }
        }
      >
        <Sidebar controlUpdateInstalledApps={controlUpdateInstalledApps} />
        <div className="w-0 grow">
          {children}
        </div>
      </ExploreContext.Provider>
    </div>
  )
}
export default React.memo(Explore)
