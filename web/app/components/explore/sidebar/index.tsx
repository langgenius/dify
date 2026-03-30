'use client'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/app/components/base/ui/alert-dialog'
import { ScrollArea } from '@/app/components/base/ui/scroll-area'
import { toast } from '@/app/components/base/ui/toast'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import Link from '@/next/link'
import { useSelectedLayoutSegments } from '@/next/navigation'
import { useGetInstalledApps, useUninstallApp, useUpdateAppPinStatus } from '@/service/use-explore'
import { cn } from '@/utils/classnames'
import Item from './app-nav-item'
import NoApps from './no-apps'

const expandedSidebarScrollAreaClassNames = {
  content: 'space-y-0.5',
  scrollbar: 'data-[orientation=vertical]:my-2 data-[orientation=vertical]:[margin-inline-end:-0.75rem]',
  viewport: 'overscroll-contain',
} as const

const SideBar = () => {
  const { t } = useTranslation()
  const segments = useSelectedLayoutSegments()
  const lastSegment = segments.slice(-1)[0]
  const isDiscoverySelected = lastSegment === 'apps'
  const { data, isPending } = useGetInstalledApps()
  const installedApps = data?.installed_apps ?? []
  const { mutateAsync: uninstallApp, isPending: isUninstalling } = useUninstallApp()
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
    toast.success(t('api.remove', { ns: 'common' }))
  }

  const handleUpdatePinStatus = async (id: string, isPinned: boolean) => {
    await updatePinStatus({ appId: id, isPinned })
    toast.success(t('api.success', { ns: 'common' }))
  }

  const pinnedAppsCount = installedApps.filter(({ is_pinned }) => is_pinned).length
  const shouldUseExpandedScrollArea = !isMobile && !isFold
  const webAppsLabelId = React.useId()
  const installedAppItems = installedApps.map(({ id, is_pinned, uninstallable, app: { name, icon_type, icon, icon_url, icon_background } }, index) => (
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
  ))

  return (
    <div className={cn('flex h-full w-fit shrink-0 cursor-pointer flex-col px-3 pt-6 sm:w-[240px]', isFold && 'sm:w-[56px]')}>
      <div className={cn(isDiscoverySelected ? 'text-text-accent' : 'text-text-tertiary')}>
        <Link
          href="/explore/apps"
          aria-label={isMobile || isFold ? t('sidebar.title', { ns: 'explore' }) : undefined}
          className={cn(isDiscoverySelected ? 'bg-state-base-active' : 'hover:bg-state-base-hover', 'flex h-8 items-center gap-2 rounded-lg px-1 mobile:w-fit mobile:justify-center pc:w-full pc:justify-start')}
        >
          <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-components-icon-bg-blue-solid">
            <span aria-hidden="true" className="i-ri-apps-fill size-3.5 text-components-avatar-shape-fill-stop-100" />
          </div>
          {!isMobile && !isFold && <div className={cn('truncate', isDiscoverySelected ? 'text-components-menu-item-text-active system-sm-semibold' : 'text-components-menu-item-text system-sm-regular')}>{t('sidebar.title', { ns: 'explore' })}</div>}
        </Link>
      </div>

      {!isPending && installedApps.length === 0 && !isMobile && !isFold
        && (
          <div className="mt-5">
            <NoApps />
          </div>
        )}

      {installedApps.length > 0 && (
        <div className="mt-5 flex min-h-0 flex-1 flex-col">
          {!isMobile && !isFold && <p id={webAppsLabelId} className="mb-1.5 break-all pl-2 uppercase text-text-tertiary system-xs-medium-uppercase mobile:px-0">{t('sidebar.webApps', { ns: 'explore' })}</p>}
          {shouldUseExpandedScrollArea
            ? (
                <div className="min-h-0 flex-1">
                  <ScrollArea
                    className="h-full"
                    slotClassNames={expandedSidebarScrollAreaClassNames}
                    labelledBy={webAppsLabelId}
                  >
                    {installedAppItems}
                  </ScrollArea>
                </div>
              )
            : (
                <div
                  className="h-full min-h-0 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden"
                >
                  {installedAppItems}
                </div>
              )}
        </div>
      )}

      {!isMobile && (
        <div className="mt-auto flex pb-3 pt-3">
          <button
            type="button"
            aria-label={isFold ? t('sidebar.expandSidebar', { ns: 'layout' }) : t('sidebar.collapseSidebar', { ns: 'layout' })}
            className="flex size-8 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-state-base-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-components-input-border-hover"
            onClick={toggleIsFold}
          >
            {isFold
              ? <span aria-hidden="true" className="i-ri-expand-right-line" />
              : (
                  <span aria-hidden="true" className="i-ri-layout-left-2-line" />
                )}
          </button>
        </div>
      )}

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <div className="flex flex-col items-start gap-2 self-stretch pb-4 pl-6 pr-6 pt-6">
            <AlertDialogTitle className="w-full text-text-primary title-2xl-semi-bold">
              {t('sidebar.delete.title', { ns: 'explore' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full whitespace-pre-wrap break-words text-text-tertiary system-md-regular">
              {t('sidebar.delete.content', { ns: 'explore' })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton disabled={isUninstalling}>
              {t('operation.cancel', { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton loading={isUninstalling} disabled={isUninstalling} onClick={handleDelete}>
              {t('operation.confirm', { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default React.memo(SideBar)
