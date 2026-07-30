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
import { useInfiniteQuery, useMutation } from '@tanstack/react-query'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import AppNavItem from '@/app/components/explore/installed-app-navigation/app-nav-item'
import { InfiniteScrollSentinel } from '@/app/components/explore/installed-app-navigation/infinite-scroll-sentinel'
import { InstalledAppPaginationSkeleton } from '@/app/components/explore/installed-app-navigation/pagination-skeleton'
import Link from '@/next/link'
import { usePathname, useSelectedLayoutSegments } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import NoApps from './no-apps'

const emptyInstalledApps: InstalledAppResponse[] = []

const selectInstalledApps = (data: InfiniteData<InstalledAppListResponse, string | undefined>) =>
  data.pages.flatMap((page) => page.installed_apps)

const SideBar = () => {
  const { t } = useTranslation()
  const pathname = usePathname()
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const segments = useSelectedLayoutSegments()
  const lastSegment = segments.slice(-1)[0]
  const isDiscoverySelected = pathname === '/' || lastSegment === 'apps'
  const installedAppsQuery = useInfiniteQuery(
    consoleQuery.installedApps.get.infiniteOptions({
      input: (pageParam: string | undefined) => ({
        query: {
          limit: 20,
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        },
      }),
      getNextPageParam: (lastPage) =>
        lastPage.has_more && lastPage.next_cursor ? lastPage.next_cursor : undefined,
      initialPageParam: undefined,
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

  const [isFold, setIsFold] = useState(false)

  const [uninstallDialogAppId, setUninstallDialogAppId] = useState<string | null>(null)
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

  const pinnedAppsCount = installedApps.filter(({ is_pinned }) => is_pinned).length
  const webAppsLabelId = React.useId()
  const installedAppItems = installedApps.map((installedApp, index) => (
    <React.Fragment key={installedApp.id}>
      <AppNavItem
        app={installedApp}
        isSelected={lastSegment?.toLowerCase() === installedApp.id}
        onTogglePin={handleUpdatePinStatus}
        onDelete={setUninstallDialogAppId}
      />
      {index === pinnedAppsCount - 1 && index !== installedApps.length - 1 && <Divider />}
    </React.Fragment>
  ))

  return (
    <div
      data-folded={isFold ? 'true' : undefined}
      className={cn(
        'group/sidebar flex h-full w-fit shrink-0 cursor-pointer flex-col px-3 pt-6 sm:w-60',
        isFold && 'sm:w-14',
      )}
    >
      <div className={cn(isDiscoverySelected ? 'text-text-accent' : 'text-text-tertiary')}>
        <Link
          href="/"
          aria-label={isFold ? t(($) => $['sidebar.title'], { ns: 'explore' }) : undefined}
          className={cn(
            isDiscoverySelected ? 'bg-state-base-active' : 'hover:bg-state-base-hover',
            'flex h-8 w-full items-center justify-start gap-2 rounded-lg px-1',
          )}
        >
          <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-components-icon-bg-blue-solid">
            <span
              aria-hidden="true"
              className="i-ri-apps-fill size-3.5 text-components-avatar-shape-fill-stop-100"
            />
          </div>
          {!isFold && (
            <div
              className={cn(
                'truncate',
                isDiscoverySelected
                  ? 'system-sm-semibold text-components-menu-item-text-active'
                  : 'system-sm-regular text-components-menu-item-text',
              )}
            >
              {t(($) => $['sidebar.title'], { ns: 'explore' })}
            </div>
          )}
        </Link>
      </div>

      {!installedAppsQuery.isPending &&
        !installedAppsQuery.isError &&
        installedApps.length === 0 &&
        !isFold && (
          <div className="mt-5">
            <NoApps />
          </div>
        )}

      {!installedAppsQuery.isPending && installedAppsQuery.isError && !isFold && (
        <div
          className="mt-5 flex flex-col items-start gap-1 px-2 system-xs-regular text-text-tertiary"
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

      {installedApps.length > 0 && (
        <div className="mt-5 flex min-h-0 flex-1 flex-col">
          {!isFold && (
            <p
              id={webAppsLabelId}
              className="mb-1.5 pl-2 system-xs-medium-uppercase break-all text-text-tertiary uppercase"
            >
              {t(($) => $['sidebar.webApps'], { ns: 'explore' })}
            </p>
          )}
          {!isFold ? (
            <div className="min-h-0 flex-1">
              <ScrollAreaRoot className="h-full">
                <ScrollAreaViewport
                  ref={scrollRef}
                  aria-busy={installedAppsQuery.isFetchingNextPage}
                  aria-labelledby={webAppsLabelId}
                  className="overscroll-contain"
                  role="region"
                >
                  <ScrollAreaContent className="space-y-0.5 pr-3">
                    {installedAppItems}
                    {installedAppsQuery.isFetchingNextPage && <InstalledAppPaginationSkeleton />}
                    <InfiniteScrollSentinel
                      canFetchNextPage={installedAppsQuery.hasNextPage && !installedAppsQuery.error}
                      fetchNextPage={() =>
                        installedAppsQuery.fetchNextPage({
                          cancelRefetch: false,
                        })
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
            </div>
          ) : (
            <div
              ref={scrollRef}
              aria-busy={installedAppsQuery.isFetchingNextPage}
              className="h-full min-h-0 flex-1 space-y-0.5 overflow-x-hidden overflow-y-auto"
            >
              {installedAppItems}
              {installedAppsQuery.isFetchingNextPage && <InstalledAppPaginationSkeleton />}
              <InfiniteScrollSentinel
                canFetchNextPage={installedAppsQuery.hasNextPage && !installedAppsQuery.error}
                fetchNextPage={() =>
                  installedAppsQuery.fetchNextPage({
                    cancelRefetch: false,
                  })
                }
                isFetchingNextPage={installedAppsQuery.isFetchingNextPage}
                scrollRootRef={scrollRef}
              />
            </div>
          )}
        </div>
      )}

      <div className="mt-auto flex py-3">
        <button
          type="button"
          aria-label={
            isFold
              ? t(($) => $['sidebar.expandSidebar'], { ns: 'layout' })
              : t(($) => $['sidebar.collapseSidebar'], { ns: 'layout' })
          }
          className="flex size-8 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-state-base-hover focus-visible:inset-ring-1 focus-visible:inset-ring-components-input-border-hover focus-visible:outline-hidden"
          onClick={() => setIsFold((value) => !value)}
        >
          {isFold ? (
            <span aria-hidden="true" className="i-ri-expand-right-line" />
          ) : (
            <span aria-hidden="true" className="i-ri-layout-left-2-line" />
          )}
        </button>
      </div>

      <AlertDialog
        open={uninstallDialogAppId !== null}
        onOpenChange={(open) => {
          if (!open) setUninstallDialogAppId(null)
        }}
      >
        <AlertDialogContent>
          <div className="flex flex-col items-start gap-2 self-stretch px-6 pt-6 pb-4">
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

export default React.memo(SideBar)
