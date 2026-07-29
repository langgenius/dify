'use client'

import type {
  InstalledAppListResponse,
  InstalledAppResponse,
} from '@dify/contracts/api/console/installed-apps/types.gen'
import type { InfiniteData } from '@tanstack/react-query'
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
import { keepPreviousData, useInfiniteQuery, useMutation } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useAtomValue } from 'jotai'
import { Fragment, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { SearchInput } from '@/app/components/base/search-input'
import AppNavItem from '@/app/components/explore/installed-app-navigation/app-nav-item'
import { InfiniteScrollSentinel } from '@/app/components/explore/installed-app-navigation/infinite-scroll-sentinel'
import { isInstalledAppPath } from '@/app/components/explore/installed-app/routes'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { usePathname } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { hasPermission } from '@/utils/permission'

const appNavItemHeight = 32
const appNavItemGap = 2
const appNavSeparatorHeight = 17
const virtualizationThreshold = 50
const webAppSkeletonClassName =
  'animate-pulse rounded bg-text-quaternary opacity-20 motion-reduce:animate-none'
const webAppSkeletonWidths = ['w-24', 'w-32', 'w-28']
const emptyInstalledApps: InstalledAppResponse[] = []

const selectInstalledApps = (data: InfiniteData<InstalledAppListResponse, string | undefined>) =>
  data.pages.flatMap((page) => page.installed_apps)

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
      {webAppSkeletonWidths.map((width) => (
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

type WebAppListRow =
  | {
      key: string
      kind: 'app'
      app: InstalledAppResponse
    }
  | {
      key: string
      kind: 'separator'
    }

const WebAppsSectionContent = () => {
  const { t } = useTranslation()
  const pathname = usePathname()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [appsExpanded, setAppsExpanded] = useState(true)
  const [searchVisible, setSearchVisible] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [uninstallDialogAppId, setUninstallDialogAppId] = useState<string | null>(null)
  const normalizedSearchText = searchText.trim()

  const installedAppsQuery = useInfiniteQuery(
    consoleQuery.installedApps.get.infiniteOptions({
      input: (pageParam: string | undefined) => ({
        query: {
          limit: 20,
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
          ...(normalizedSearchText ? { name: normalizedSearchText } : {}),
        },
      }),
      getNextPageParam: (lastPage) =>
        lastPage.has_more && lastPage.next_cursor ? lastPage.next_cursor : undefined,
      initialPageParam: undefined,
      placeholderData: keepPreviousData,
      select: selectInstalledApps,
    }),
  )
  const installedApps = installedAppsQuery.data ?? emptyInstalledApps
  const uninstallAppMutation = useMutation(
    consoleQuery.installedApps.byInstalledAppId.delete.mutationOptions(),
  )
  const updatePinStatusMutation = useMutation(
    consoleQuery.installedApps.byInstalledAppId.patch.mutationOptions(),
  )

  const webAppRows = useMemo<WebAppListRow[]>(() => {
    const pinnedAppsCount = installedApps.filter(({ is_pinned }) => is_pinned).length

    return installedApps.flatMap((app, index) => {
      const rows: WebAppListRow[] = [
        {
          key: app.id,
          kind: 'app',
          app,
        },
      ]

      if (index === pinnedAppsCount - 1 && index !== installedApps.length - 1) {
        rows.push({
          key: `${app.id}-separator`,
          kind: 'separator',
        })
      }

      return rows
    })
  }, [installedApps])
  const shouldVirtualize = webAppRows.length > virtualizationThreshold

  const rowVirtualizer = useVirtualizer({
    count: webAppRows.length,
    estimateSize: (index) =>
      webAppRows[index]?.kind === 'separator' ? appNavSeparatorHeight : appNavItemHeight,
    gap: appNavItemGap,
    getItemKey: (index) => webAppRows[index]?.key ?? index,
    getScrollElement: () => scrollRef.current,
    overscan: 6,
    paddingEnd: 8,
  })
  const virtualRows = rowVirtualizer.getVirtualItems()

  const handleDelete = () => {
    if (!uninstallDialogAppId) return

    uninstallAppMutation.mutate(
      {
        params: { installed_app_id: uninstallDialogAppId },
      },
      {
        onSuccess: () => {
          setUninstallDialogAppId(null)
          toast.success(t(($) => $['api.remove'], { ns: 'common' }))
        },
      },
    )
  }

  const handleUpdatePinStatus = (id: string, isPinned: boolean) => {
    updatePinStatusMutation.mutate(
      {
        params: { installed_app_id: id },
        body: { is_pinned: isPinned },
      },
      {
        onSuccess: () => toast.success(t(($) => $['api.success'], { ns: 'common' })),
      },
    )
  }

  if (
    !installedAppsQuery.isPending &&
    !installedAppsQuery.isError &&
    installedApps.length === 0 &&
    !normalizedSearchText
  )
    return null

  const renderAppNavItem = (installedApp: (typeof installedApps)[number]) => (
    <AppNavItem
      key={installedApp.id}
      variant="mainNav"
      app={installedApp}
      ariaLabel={t(($) => $['mainNav.webApps.openApp'], {
        ns: 'common',
        name: installedApp.app.name,
      })}
      isSelected={isInstalledAppPath(pathname, installedApp.id)}
      onTogglePin={handleUpdatePinStatus}
      onDelete={setUninstallDialogAppId}
    />
  )
  const renderRow = (row: WebAppListRow) => {
    if (row.kind === 'separator') return <Divider />

    return renderAppNavItem(row.app)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {installedAppsQuery.isPending ? (
        <WebAppsHeaderSkeleton />
      ) : (
        <div className="flex items-center justify-between py-1 pr-2 pl-2">
          <button
            type="button"
            aria-expanded={appsExpanded}
            className="flex min-w-0 items-center rounded-md px-2 py-1 text-left system-xs-medium-uppercase text-text-tertiary outline-hidden hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={() => setAppsExpanded((value) => !value)}
          >
            <span>{t(($) => $['sidebar.webApps'], { ns: 'explore' })}</span>
            <span
              aria-hidden
              className={cn(
                'i-ri-arrow-down-s-fill h-4 w-4 shrink-0 transition-transform',
                !appsExpanded && '-rotate-90',
              )}
            />
          </button>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              aria-label={t(($) => $['operation.search'], { ns: 'common' })}
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-md p-0.5 text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                searchVisible && 'bg-state-base-hover text-text-secondary',
              )}
              onClick={() => {
                setAppsExpanded(true)
                setSearchVisible((value) => {
                  if (value) setSearchText('')
                  return !value
                })
              }}
            >
              <span className="flex size-5 shrink-0 items-center justify-center">
                <span aria-hidden className="i-ri-search-line size-3.5" />
              </span>
            </button>
          </div>
        </div>
      )}
      {!installedAppsQuery.isPending && appsExpanded && searchVisible && (
        <div className="px-2 pb-2">
          <SearchInput
            value={searchText}
            onValueChange={setSearchText}
            placeholder={t(($) => $['mainNav.webApps.searchPlaceholder'], { ns: 'common' })}
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- The field is mounted after an explicit search action.
            autoFocus
          />
        </div>
      )}
      {appsExpanded && (
        <ScrollAreaRoot className="relative min-h-0 flex-1 overflow-hidden overscroll-contain">
          <ScrollAreaViewport
            ref={scrollRef}
            aria-busy={installedAppsQuery.isFetching}
            aria-label={t(($) => $['sidebar.webApps'], { ns: 'explore' })}
            className="overflow-x-hidden"
            role="region"
          >
            <ScrollAreaContent className="w-full max-w-full min-w-0! px-2">
              {installedAppsQuery.isPending && <WebAppsSkeleton />}
              {!installedAppsQuery.isPending && installedAppsQuery.isError && (
                <div
                  className="flex flex-col items-start gap-1 px-2 py-2 system-xs-regular text-text-tertiary"
                  role="alert"
                >
                  <span>{t(($) => $['errorBoundary.title'], { ns: 'common' })}</span>
                  <button
                    type="button"
                    className="text-text-accent outline-hidden hover:underline focus-visible:underline"
                    onClick={() => {
                      if (installedAppsQuery.isFetchNextPageError)
                        void installedAppsQuery.fetchNextPage({ cancelRefetch: false })
                      else void installedAppsQuery.refetch()
                    }}
                  >
                    {t(($) => $['operation.retry'], { ns: 'common' })}
                  </button>
                </div>
              )}
              {!installedAppsQuery.isPending &&
                !installedAppsQuery.isError &&
                installedApps.length === 0 && (
                  <div className="px-2 py-1 system-xs-regular">
                    {t(($) => $['mainNav.webApps.noResults'], { ns: 'common' })}
                  </div>
                )}
              {!installedAppsQuery.isPending && webAppRows.length > 0 && !shouldVirtualize && (
                <div className="space-y-0.5 pb-2">
                  {webAppRows.map((row) => (
                    <Fragment key={row.key}>{renderRow(row)}</Fragment>
                  ))}
                </div>
              )}
              {!installedAppsQuery.isPending && shouldVirtualize && (
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
              <InfiniteScrollSentinel
                fetchNextPage={() =>
                  installedAppsQuery.fetchNextPage({
                    cancelRefetch: false,
                  })
                }
                isEnabled={
                  installedAppsQuery.hasNextPage &&
                  !installedAppsQuery.isFetching &&
                  !installedAppsQuery.error
                }
                isFetchingNextPage={installedAppsQuery.isFetchingNextPage}
                scrollRootRef={scrollRef}
              />
            </ScrollAreaContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
        </ScrollAreaRoot>
      )}
      <AlertDialog
        open={uninstallDialogAppId !== null}
        onOpenChange={(open) => {
          if (!open) setUninstallDialogAppId(null)
        }}
      >
        <AlertDialogContent>
          <div className="flex flex-col items-start gap-2 self-stretch pt-6 pr-6 pb-4 pl-6">
            <AlertDialogTitle className="w-full title-2xl-semi-bold text-text-primary">
              {t(($) => $['sidebar.delete.title'], { ns: 'explore' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t(($) => $['sidebar.delete.content'], { ns: 'explore' })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton disabled={uninstallAppMutation.isPending}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              loading={uninstallAppMutation.isPending}
              disabled={uninstallAppMutation.isPending}
              onClick={handleDelete}
            >
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

const WebAppsSection = () => {
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canAccessAppLibrary = hasPermission(workspacePermissionKeys, 'app_library.access')

  if (!canAccessAppLibrary) return null

  return <WebAppsSectionContent />
}

export default WebAppsSection
