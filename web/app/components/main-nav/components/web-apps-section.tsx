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
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { toast } from '@langgenius/dify-ui/toast'
import { keepPreviousData, useInfiniteQuery, useMutation } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { Fragment, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { InfiniteScrollSentinel } from '@/app/components/base/infinite-scroll-sentinel'
import { SearchInput } from '@/app/components/base/search-input'
import AppNavItem from '@/app/components/explore/installed-app-navigation/app-nav-item'
import { InstalledAppPaginationSkeleton } from '@/app/components/explore/installed-app-navigation/pagination-skeleton'
import { isInstalledAppPath } from '@/app/components/explore/installed-app/routes'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { usePathname } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { hasPermission } from '@/utils/permission'

const emptyInstalledApps: InstalledAppResponse[] = []

const getPreloadDistance = (scrollContainer: Element) =>
  Math.max(160, Math.min(scrollContainer.clientHeight * 0.25, 320))

const selectInstalledApps = (data: InfiniteData<InstalledAppListResponse, string | undefined>) =>
  data.pages.flatMap((page) => page.installed_apps)

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

  const pinnedAppsCount = installedApps.filter(({ is_pinned }) => is_pinned).length
  const canLoadMore = !installedAppsQuery.isFetching && !installedAppsQuery.error

  const handleSearchTextChange = (value: string) => {
    scrollRef.current?.scrollTo({ top: 0 })
    setSearchText(value)
  }

  const handleSearchVisibleChange = (visible: boolean) => {
    setAppsExpanded(true)
    if (!visible) handleSearchTextChange('')
    setSearchVisible(visible)
  }

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

  if (installedAppsQuery.isPending) return null

  if (!installedAppsQuery.isError && installedApps.length === 0 && !normalizedSearchText)
    return null

  const renderAppNavItem = (installedApp: (typeof installedApps)[number]) => (
    <AppNavItem
      key={installedApp.id}
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
  return (
    <Collapsible
      open={appsExpanded && searchVisible}
      onOpenChange={handleSearchVisibleChange}
      className="flex min-h-0 flex-1 flex-col"
    >
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
          <CollapsibleTrigger
            className="size-6 min-h-0 w-6 justify-center gap-0 rounded-md p-0.5 hover:not-data-disabled:bg-state-base-hover hover:not-data-disabled:text-text-secondary data-panel-open:bg-state-base-hover data-panel-open:text-text-secondary"
            render={
              <IconButton
                aria-label={t(($) => $['operation.search'], { ns: 'common' })}
                className="rounded-md"
              >
                <span className="flex size-5 shrink-0 items-center justify-center">
                  <span aria-hidden className="i-ri-search-line size-3.5" />
                </span>
              </IconButton>
            }
          />
        </div>
      </div>
      <CollapsiblePanel className="shrink-0">
        <div className="px-2 pb-2">
          <SearchInput
            value={searchText}
            onValueChange={handleSearchTextChange}
            placeholder={t(($) => $['mainNav.webApps.searchPlaceholder'], { ns: 'common' })}
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- The field is mounted after an explicit search action.
            autoFocus
          />
        </div>
      </CollapsiblePanel>
      {appsExpanded && (
        <ScrollArea className="relative min-h-0 flex-1 overflow-hidden">
          <ScrollAreaViewport
            ref={scrollRef}
            aria-busy={installedAppsQuery.isFetchingNextPage}
            aria-label={t(($) => $['sidebar.webApps'], { ns: 'explore' })}
            style={{ overflowX: 'hidden' }}
            className="overscroll-contain"
            role="region"
          >
            <ScrollAreaContent style={{ minWidth: 0 }} className="w-full max-w-full px-2">
              {installedAppsQuery.isError && !installedAppsQuery.isFetchNextPageError && (
                <div
                  className="flex flex-col items-start gap-1 px-2 py-2 system-xs-regular text-text-tertiary"
                  role="alert"
                >
                  <span>{t(($) => $['errorBoundary.title'], { ns: 'common' })}</span>
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => {
                      void installedAppsQuery.refetch()
                    }}
                  >
                    {t(($) => $['operation.retry'], { ns: 'common' })}
                  </Button>
                </div>
              )}
              {!installedAppsQuery.isError && installedApps.length === 0 && (
                <div className="px-2 py-1 system-xs-regular">
                  {t(($) => $['mainNav.webApps.noResults'], { ns: 'common' })}
                </div>
              )}
              {installedApps.length > 0 && (
                <div className="space-y-0.5 pb-2">
                  {installedApps.map((installedApp, index) => (
                    <Fragment key={installedApp.id}>
                      {renderAppNavItem(installedApp)}
                      {index === pinnedAppsCount - 1 && index !== installedApps.length - 1 && (
                        <Divider />
                      )}
                    </Fragment>
                  ))}
                </div>
              )}
              {installedAppsQuery.hasNextPage && (
                <div className="relative">
                  <InfiniteScrollSentinel
                    canLoadMore={canLoadMore}
                    onLoadMore={() => {
                      void installedAppsQuery.fetchNextPage({
                        cancelRefetch: false,
                      })
                    }}
                    preloadDistance={getPreloadDistance}
                    scrollContainerRef={scrollRef}
                  />
                  <InstalledAppPaginationSkeleton />
                  {installedAppsQuery.isFetchNextPageError && (
                    <div
                      className="absolute inset-0 flex items-center justify-center gap-2 bg-background-body px-2 system-xs-regular text-text-tertiary"
                      role="alert"
                    >
                      <span>{t(($) => $['errorBoundary.title'], { ns: 'common' })}</span>
                      <Button
                        loading={installedAppsQuery.isFetchingNextPage}
                        size="small"
                        variant="secondary"
                        onClick={() => {
                          void installedAppsQuery.fetchNextPage({ cancelRefetch: false })
                        }}
                      >
                        {t(($) => $['operation.retry'], { ns: 'common' })}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </ScrollAreaContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
        </ScrollArea>
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
    </Collapsible>
  )
}

const WebAppsSection = () => {
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canAccessAppLibrary = hasPermission(workspacePermissionKeys, 'app_library.access')

  if (!canAccessAppLibrary) return null

  return <WebAppsSectionContent />
}

export default WebAppsSection
