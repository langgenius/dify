'use client'

import type { InstalledApp } from '@/models/explore'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { cn } from '@langgenius/dify-ui/cn'
import {
  ScrollAreaContent,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { toast } from '@langgenius/dify-ui/toast'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Fragment, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { SearchInput } from '@/app/components/base/search-input'
import { isInstalledAppPath } from '@/app/components/explore/installed-app/routes'
import AppNavItem from '@/app/components/explore/sidebar/app-nav-item'
import { useAppContext } from '@/context/app-context'
import { usePathname } from '@/next/navigation'
import { useGetInstalledApps, useUninstallApp, useUpdateAppPinStatus } from '@/service/use-explore'
import { hasPermission } from '@/utils/permission'

const appNavItemHeight = 32
const appNavItemGap = 2
const appNavSeparatorHeight = 17
const virtualizationThreshold = 50
const webAppSkeletonClassName = 'animate-pulse rounded bg-text-quaternary opacity-20 motion-reduce:animate-none'
const webAppSkeletonWidths = ['w-24', 'w-32', 'w-28']

function WebAppsHeaderSkeleton() {
  return (
    <div aria-hidden="true" className="flex h-8 items-center justify-between p-2">
      <div className={cn(webAppSkeletonClassName, 'h-3 w-20')} />
      <div className={cn(webAppSkeletonClassName, 'size-4 rounded-md')} />
    </div>
  )
}

function WebAppsSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-0.5 pb-2">
      {webAppSkeletonWidths.map(width => (
        <div key={width} className="flex h-8 items-center gap-2 rounded-lg py-0.5 pr-0.5 pl-2">
          <div className={cn(webAppSkeletonClassName, 'size-5 shrink-0 rounded-md')} />
          <div className="min-w-0 flex-1 py-1 pr-1">
            <div className={cn(webAppSkeletonClassName, 'h-3', width)} />
          </div>
          <div className={cn(webAppSkeletonClassName, 'mr-1 h-3 w-3 shrink-0')} />
        </div>
      ))}
    </div>
  )
}

type WebAppListRow
  = | {
    key: string
    kind: 'app'
    app: InstalledApp
  }
  | {
    key: string
    kind: 'separator'
  }

const WebAppsSectionContent = () => {
  const { t } = useTranslation()
  const pathname = usePathname()
  const scrollRef = useRef<HTMLDivElement>(null)
  const { data, isPending } = useGetInstalledApps()
  const installedApps = useMemo(() => data?.installed_apps ?? [], [data?.installed_apps])
  const { mutateAsync: uninstallApp, isPending: isUninstalling } = useUninstallApp()
  const { mutateAsync: updatePinStatus } = useUpdateAppPinStatus()
  const [appsExpanded, setAppsExpanded] = useState(true)
  const [searchVisible, setSearchVisible] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [currentId, setCurrentId] = useState('')

  const filteredApps = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase()
    if (!normalizedSearch)
      return installedApps

    return installedApps.filter(item => item.app.name.toLowerCase().includes(normalizedSearch))
  }, [installedApps, searchText])
  const webAppRows = useMemo<WebAppListRow[]>(() => {
    const pinnedAppsCount = filteredApps.filter(({ is_pinned }) => is_pinned).length

    return filteredApps.flatMap((app, index) => {
      const rows: WebAppListRow[] = [
        {
          key: app.id,
          kind: 'app',
          app,
        },
      ]

      if (index === pinnedAppsCount - 1 && index !== filteredApps.length - 1) {
        rows.push({
          key: `${app.id}-separator`,
          kind: 'separator',
        })
      }

      return rows
    })
  }, [filteredApps])
  const shouldVirtualize = webAppRows.length > virtualizationThreshold

  const rowVirtualizer = useVirtualizer({
    count: webAppRows.length,
    estimateSize: index => webAppRows[index]?.kind === 'separator' ? appNavSeparatorHeight : appNavItemHeight,
    gap: appNavItemGap,
    getItemKey: index => webAppRows[index]?.key ?? index,
    getScrollElement: () => scrollRef.current,
    overscan: 6,
    paddingEnd: 8,
  })
  const virtualRows = rowVirtualizer.getVirtualItems()

  const handleDelete = async () => {
    await uninstallApp(currentId)
    setShowConfirm(false)
    toast.success(t('api.remove', { ns: 'common' }))
  }

  const handleUpdatePinStatus = async (id: string, isPinned: boolean) => {
    await updatePinStatus({ appId: id, isPinned })
    toast.success(t('api.success', { ns: 'common' }))
  }

  if (!isPending && installedApps.length === 0)
    return null

  const renderAppNavItem = ({ id, is_pinned, uninstallable, app }: (typeof filteredApps)[number]) => (
    <AppNavItem
      key={id}
      variant="mainNav"
      isMobile={false}
      name={app.name}
      icon_type={app.icon_type}
      icon={app.icon}
      icon_background={app.icon_background}
      icon_url={app.icon_url}
      id={id}
      isSelected={isInstalledAppPath(pathname, id)}
      isPinned={is_pinned}
      togglePin={() => {
        void handleUpdatePinStatus(id, !is_pinned)
      }}
      uninstallable={uninstallable}
      onDelete={(id) => {
        setCurrentId(id)
        setShowConfirm(true)
      }}
    />
  )
  const renderRow = (row: WebAppListRow) => {
    if (row.kind === 'separator')
      return <Divider />

    return renderAppNavItem(row.app)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {isPending
        ? <WebAppsHeaderSkeleton />
        : (
            <div className="flex items-center justify-between py-1 pr-2 pl-2">
              <button
                type="button"
                aria-expanded={appsExpanded}
                className="flex min-w-0 items-center rounded-md px-2 py-1 text-left system-xs-medium-uppercase text-text-tertiary outline-hidden hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                onClick={() => setAppsExpanded(value => !value)}
              >
                <span>{t('sidebar.webApps', { ns: 'explore' })}</span>
                <span aria-hidden className={cn('i-ri-arrow-down-s-fill h-4 w-4 shrink-0 transition-transform', !appsExpanded && '-rotate-90')} />
              </button>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  aria-label={t('operation.search', { ns: 'common' })}
                  className={cn('flex h-6 w-6 items-center justify-center rounded-md p-0.5 text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid', searchVisible && 'bg-state-base-hover text-text-secondary')}
                  onClick={() => {
                    setAppsExpanded(true)
                    setSearchVisible(value => !value)
                  }}
                >
                  <span className="flex size-5 shrink-0 items-center justify-center">
                    <span aria-hidden className="i-ri-search-line size-3.5" />
                  </span>
                </button>
              </div>
            </div>
          )}
      {!isPending && appsExpanded && searchVisible && (
        <div className="px-2 pb-2">
          <SearchInput
            value={searchText}
            onValueChange={setSearchText}
            placeholder={t('mainNav.webApps.searchPlaceholder', { ns: 'common' })}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- The field is mounted after an explicit search action.
            autoFocus
          />
        </div>
      )}
      {appsExpanded && (
        <ScrollAreaRoot className="relative min-h-0 flex-1 overflow-hidden overscroll-contain">
          <ScrollAreaViewport
            ref={scrollRef}
            aria-busy={isPending}
            aria-label={t('sidebar.webApps', { ns: 'explore' })}
            className="overflow-x-hidden"
            role="region"
          >
            <ScrollAreaContent className="w-full max-w-full min-w-0! pr-5 pl-2">
              {isPending && (
                <WebAppsSkeleton />
              )}
              {!isPending && filteredApps.length === 0 && (
                <div className="px-2 py-1 system-xs-regular">
                  {t('mainNav.webApps.noResults', { ns: 'common' })}
                </div>
              )}
              {!isPending && webAppRows.length > 0 && !shouldVirtualize && (
                <div className="space-y-0.5 pb-2">
                  {webAppRows.map(row => (
                    <Fragment key={row.key}>
                      {renderRow(row)}
                    </Fragment>
                  ))}
                </div>
              )}
              {!isPending && shouldVirtualize && (
                <div
                  className="relative w-full"
                  style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                  }}
                >
                  {virtualRows.map((virtualRow) => {
                    const row = webAppRows[virtualRow.index]!

                    return (
                      <div
                        key={virtualRow.key}
                        className="absolute top-0 left-0 w-full"
                        style={{
                          height: `${virtualRow.size}px`,
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        {renderRow(row)}
                      </div>
                    )
                  })}
                </div>
              )}
            </ScrollAreaContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
        </ScrollAreaRoot>
      )}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <div className="flex flex-col items-start gap-2 self-stretch pt-6 pr-6 pb-4 pl-6">
            <AlertDialogTitle className="w-full title-2xl-semi-bold text-text-primary">
              {t('sidebar.delete.title', { ns: 'explore' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
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

const WebAppsSection = () => {
  const { workspacePermissionKeys } = useAppContext()
  const canAccessAppLibrary = hasPermission(workspacePermissionKeys, 'app_library.access')

  if (!canAccessAppLibrary)
    return null

  return <WebAppsSectionContent />
}

export default WebAppsSection
