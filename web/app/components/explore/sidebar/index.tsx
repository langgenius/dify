'use client'
import type { FC } from 'react'
import { RiAppsFill, RiExpandRightLine, RiLayoutLeft2Line } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import Link from 'next/link'
import { useSelectedLayoutSegments } from 'next/navigation'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import Confirm from '@/app/components/base/confirm'
import Divider from '@/app/components/base/divider'
import ExploreContext from '@/context/explore-context'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { useGetInstalledApps, useUninstallApp, useUpdateAppPinStatus } from '@/service/use-explore'
import { cn } from '@/utils/classnames'
import Toast from '../../base/toast'
import Item from './app-nav-item'
import NoApps from './no-apps'

export type IExploreSideBarProps = {
  controlUpdateInstalledApps: number
}

const SideBar: FC<IExploreSideBarProps> = ({
  controlUpdateInstalledApps,
}) => {
  const { t } = useTranslation()
  const segments = useSelectedLayoutSegments()
  const lastSegment = segments.slice(-1)[0]
  const isDiscoverySelected = lastSegment === 'apps'
  const { installedApps, setInstalledApps, setIsFetchingInstalledApps } = useContext(ExploreContext)
  const { isFetching: isFetchingInstalledApps, data: ret, refetch: fetchInstalledAppList } = useGetInstalledApps()
  const { mutateAsync: uninstallApp } = useUninstallApp()
  const { mutateAsync: updatePinStatus } = useUpdateAppPinStatus()

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const [isFold, {
    toggle: toggleIsFold,
  }] = useBoolean(false)

  const [showConfirm, setShowConfirm] = useState(false)
  const [currId, setCurrId] = useState('')
  const handleDelete = async () => {
    const id = currId
    await uninstallApp(id)
    setShowConfirm(false)
    Toast.notify({
      type: 'success',
      message: t('api.remove', { ns: 'common' }),
    })
  }

  const handleUpdatePinStatus = async (id: string, isPinned: boolean) => {
    await updatePinStatus({ appId: id, isPinned })
    Toast.notify({
      type: 'success',
      message: t('api.success', { ns: 'common' }),
    })
  }

  useEffect(() => {
    const installed_apps = (ret as any)?.installed_apps
    if (installed_apps && installed_apps.length > 0)
      setInstalledApps(installed_apps)
    else
      setInstalledApps([])
  }, [ret, setInstalledApps])

  useEffect(() => {
    setIsFetchingInstalledApps(isFetchingInstalledApps)
  }, [isFetchingInstalledApps, setIsFetchingInstalledApps])

  useEffect(() => {
    fetchInstalledAppList()
  }, [controlUpdateInstalledApps, fetchInstalledAppList])

  const pinnedAppsCount = installedApps.filter(({ is_pinned }) => is_pinned).length
  return (
    <div className={cn('relative w-fit shrink-0 cursor-pointer px-3 pt-6 sm:w-[240px]', isFold && 'sm:w-[56px]')}>
      <div className={cn(isDiscoverySelected ? 'text-text-accent' : 'text-text-tertiary')}>
        <Link
          href="/explore/apps"
          className={cn(isDiscoverySelected ? 'bg-state-base-active' : 'hover:bg-state-base-hover', 'flex h-8 items-center gap-2 rounded-lg px-1 mobile:w-fit mobile:justify-center pc:w-full pc:justify-start')}
        >
          <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-components-icon-bg-blue-solid">
            <RiAppsFill className="size-3.5 text-components-avatar-shape-fill-stop-100" />
          </div>
          {!isMobile && !isFold && <div className={cn('truncate', isDiscoverySelected ? 'system-sm-semibold text-components-menu-item-text-active' : 'system-sm-regular text-components-menu-item-text')}>{t('sidebar.title', { ns: 'explore' })}</div>}
        </Link>
      </div>

      {installedApps.length === 0 && !isMobile && !isFold
        && (
          <div className="mt-5">
            <NoApps />
          </div>
        )}

      {installedApps.length > 0 && (
        <div className="mt-5">
          {!isMobile && !isFold && <p className="system-xs-medium-uppercase mb-1.5 break-all pl-2 uppercase text-text-tertiary mobile:px-0">{t('sidebar.webApps', { ns: 'explore' })}</p>}
          <div
            className="space-y-0.5 overflow-y-auto overflow-x-hidden"
            style={{
              height: 'calc(100vh - 250px)',
            }}
          >
            {installedApps.map(({ id, is_pinned, uninstallable, app: { name, icon_type, icon, icon_url, icon_background } }, index) => (
              <React.Fragment key={id}>
                <Item
                  isMobile={isMobile || isFold}
                  name={name}
                  icon_type={icon_type}
                  icon={icon}
                  icon_background={icon_background}
                  icon_url={icon_url}
                  id={id}
                  isSelected={lastSegment?.toLowerCase() === id}
                  isPinned={is_pinned}
                  togglePin={() => handleUpdatePinStatus(id, !is_pinned)}
                  uninstallable={uninstallable}
                  onDelete={(id) => {
                    setCurrId(id)
                    setShowConfirm(true)
                  }}
                />
                {index === pinnedAppsCount - 1 && index !== installedApps.length - 1 && <Divider />}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {!isMobile && (
        <div className="absolute bottom-3 left-3 flex size-8 cursor-pointer items-center justify-center text-text-tertiary" onClick={toggleIsFold}>
          {isFold
            ? <RiExpandRightLine className="size-4.5" />
            : (
                <RiLayoutLeft2Line className="size-4.5" />
              )}
        </div>
      )}

      {showConfirm && (
        <Confirm
          title={t('sidebar.delete.title', { ns: 'explore' })}
          content={t('sidebar.delete.content', { ns: 'explore' })}
          isShow={showConfirm}
          onConfirm={handleDelete}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  )
}

export default React.memo(SideBar)
