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
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { useAtomValue } from 'jotai'
import { use, useCallback, useId, useMemo, useRef, useState } from 'react'
import { browser } from 'react-dom'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { InfiniteScrollSentinel } from '@/app/components/base/infinite-scroll-sentinel'
import { SearchInput } from '@/app/components/base/search-input'
import AppNavItem from '@/app/components/explore/installed-app-navigation/app-nav-item'
import { InstalledAppPaginationSkeleton } from '@/app/components/explore/installed-app-navigation/pagination-skeleton'
import { isInstalledAppPath } from '@/app/components/explore/installed-app/routes'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { usePathname } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { hasPermission } from '@/utils/permission'

const emptyInstalledApps: InstalledAppResponse[] = []

const appNavItemHeight = 28
const appNavItemGap = 1
const appNavSeparatorHeight = 12

const getPreloadDistance = (scrollContainer: Element) =>
  Math.max(160, Math.min(scrollContainer.clientHeight * 0.25, 320))

const selectInstalledApps = (data: InfiniteData<InstalledAppListResponse, string | undefined>) =>
  data.pages.flatMap((page) => page.installed_apps)

type WebAppListRow =
  | {
      key: string
      kind: 'app'
      app: InstalledAppResponse
      position: number
    }
  | {
      key: string
      kind: 'separator'
    }

const WebAppsSectionContent = () => {
  const { t } = useTranslation()
  const pathname = usePathname()
  const scrollRef = useRef<HTMLDivElement>(null)
  const sectionToggleRef = useRef<HTMLButtonElement>(null)
  const searchFocusRequestedRef = useRef(false)
  const sectionLabelId = useId()
  const [lastFocusedAppId, setLastFocusedAppId] = useState<string | null>(null)
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
      const rows: WebAppListRow[] = [{ key: app.id, kind: 'app', app, position: index + 1 }]

      if (index === pinnedAppsCount - 1 && index !== installedApps.length - 1)
        rows.push({ key: `${app.id}-separator`, kind: 'separator' })

      return rows
    })
  }, [installedApps])
  const getWebAppRowKey = useCallback(
    (index: number) => webAppRows[index]?.key ?? index,
    [webAppRows],
  )
  const focusedRowIndex = webAppRows.findIndex((row) => row.key === lastFocusedAppId)
  const getVisibleRows = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) => {
      const visibleRows = defaultRangeExtractor(range)
      if (focusedRowIndex < 0) return visibleRows

      // Retain the focused row and its neighbors so scrolling cannot remove the Tab target.
      const previousAppIndex =
        focusedRowIndex - (webAppRows[focusedRowIndex - 1]?.kind === 'separator' ? 2 : 1)
      const nextAppIndex =
        focusedRowIndex + (webAppRows[focusedRowIndex + 1]?.kind === 'separator' ? 2 : 1)
      const focusRows = [previousAppIndex, focusedRowIndex, nextAppIndex].filter(
        (index) => index >= 0 && index < range.count,
      )
      return [...new Set([...visibleRows, ...focusRows])].sort((a, b) => a - b)
    },
    [focusedRowIndex, webAppRows],
  )

  const rowVirtualizer = useVirtualizer({
    count: webAppRows.length,
    estimateSize: (index) =>
      webAppRows[index]?.kind === 'separator' ? appNavSeparatorHeight : appNavItemHeight,
    gap: appNavItemGap,
    getItemKey: getWebAppRowKey,
    rangeExtractor: getVisibleRows,
    getScrollElement: () => scrollRef.current,
    overscan: 6,
    paddingEnd: installedAppsQuery.hasNextPage ? 0 : 8,
  })

  const canLoadMore = !installedAppsQuery.isFetching && !installedAppsQuery.error
  const noResultsMessage = t(($) => $['mainNav.webApps.noResults'], { ns: 'common' })
  const showNoResults =
    !installedAppsQuery.isError &&
    !installedAppsQuery.isFetching &&
    !installedAppsQuery.isPlaceholderData &&
    installedApps.length === 0

  const handleSearchTextChange = (value: string) => {
    scrollRef.current?.scrollTo({ top: 0 })
    setSearchText(value)
  }

  const handleSearchVisibleChange = (visible: boolean) => {
    searchFocusRequestedRef.current = visible
    setAppsExpanded(true)
    if (!visible) handleSearchTextChange('')
    setSearchVisible(visible)
  }
  const focusSearchOnAttach = useCallback((input: HTMLInputElement | null) => {
    if (!input || !searchFocusRequestedRef.current) return
    searchFocusRequestedRef.current = false
    input.focus()
  }, [])

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

  if (
    !installedAppsQuery.isError &&
    !installedAppsQuery.isPlaceholderData &&
    installedApps.length === 0 &&
    !normalizedSearchText &&
    !searchVisible &&
    uninstallDialogAppId === null &&
    !uninstallAppMutation.isSuccess
  )
    return null

  return (
    <Collapsible
      open={appsExpanded}
      onOpenChange={setAppsExpanded}
      className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto_minmax(0,1fr)]"
    >
      <CollapsibleTrigger
        ref={sectionToggleRef}
        className="group/collapsible col-start-1 row-start-1 my-1 ml-2 flex min-h-6 w-fit min-w-0 touch-manipulation items-center justify-start gap-0 rounded-md px-2 py-1 text-left system-sm-medium text-text-tertiary outline-hidden select-none hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
      >
        <span id={sectionLabelId} className="system-xs-medium-uppercase">
          {t(($) => $['sidebar.webApps'], { ns: 'explore' })}
        </span>
        <span
          aria-hidden
          className="i-ri-arrow-down-s-fill h-4 w-4 shrink-0 -rotate-90 transition-transform group-data-panel-open/collapsible:rotate-0 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <Collapsible
        open={appsExpanded && searchVisible}
        onOpenChange={handleSearchVisibleChange}
        className="contents"
      >
        <CollapsibleTrigger
          className="col-start-2 row-start-1 my-1 mr-2 self-center text-text-secondary data-panel-open:bg-state-base-hover"
          render={
            <IconButton aria-label={t(($) => $['operation.search'], { ns: 'common' })}>
              <span aria-hidden className="i-ri-search-line size-3.5" />
            </IconButton>
          }
        />
        <CollapsiblePanel className="col-span-2 row-start-2">
          <div className="px-2 pb-2">
            <SearchInput
              ref={focusSearchOnAttach}
              value={searchText}
              onValueChange={handleSearchTextChange}
              placeholder={t(($) => $['mainNav.webApps.searchPlaceholder'], { ns: 'common' })}
              aria-label={t(($) => $['mainNav.webApps.searchPlaceholder'], { ns: 'common' })}
            />
          </div>
        </CollapsiblePanel>
      </Collapsible>
      <CollapsiblePanel className="col-span-2 row-start-3 flex h-full min-h-0 flex-col transition-none data-ending-style:h-full data-starting-style:h-full">
        <ScrollArea className="min-h-0 flex-1 overflow-hidden">
          <ScrollAreaViewport
            ref={scrollRef}
            aria-busy={installedAppsQuery.isFetching}
            aria-labelledby={sectionLabelId}
            style={{ overflowX: 'hidden' }}
            className="overscroll-contain focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset"
            role="navigation"
          >
            <ScrollAreaContent style={{ minWidth: 0 }} className="w-full max-w-full px-2">
              <div className="sr-only" role="status">
                {showNoResults ? noResultsMessage : ''}
              </div>
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
              {showNoResults && (
                <div className="px-2 py-1 system-xs-regular">{noResultsMessage}</div>
              )}
              {webAppRows.length > 0 && (
                <ul
                  className="relative w-full"
                  style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                >
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const row = webAppRows[virtualRow.index]!

                    return (
                      <li
                        key={virtualRow.key}
                        aria-hidden={row.kind === 'separator' ? true : undefined}
                        aria-posinset={row.kind === 'app' ? row.position : undefined}
                        aria-setsize={
                          row.kind === 'app'
                            ? installedAppsQuery.hasNextPage
                              ? -1
                              : installedApps.length
                            : undefined
                        }
                        onFocusCapture={
                          row.kind === 'app' ? () => setLastFocusedAppId(row.app.id) : undefined
                        }
                        className="absolute top-0 left-0 w-full"
                        style={{
                          height: `${virtualRow.size}px`,
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        {row.kind === 'separator' ? (
                          <div className="flex h-3 items-center px-1">
                            <Divider className="m-0 h-px bg-divider-subtle" />
                          </div>
                        ) : (
                          <AppNavItem
                            app={row.app}
                            isSelected={isInstalledAppPath(pathname, row.app.id)}
                            onTogglePin={handleUpdatePinStatus}
                            onDelete={(id) => {
                              uninstallAppMutation.reset()
                              setUninstallDialogAppId(id)
                            }}
                          />
                        )}
                      </li>
                    )
                  })}
                </ul>
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
      </CollapsiblePanel>
      <AlertDialog
        open={uninstallDialogAppId !== null}
        onOpenChange={(open, details) => {
          if (uninstallAppMutation.isPending) {
            details.cancel()
            return
          }
          if (!open) setUninstallDialogAppId(null)
        }}
      >
        <AlertDialogContent
          finalFocus={() => (uninstallAppMutation.isSuccess ? sectionToggleRef.current : true)}
        >
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
  use(browser('The installed apps navigation renders in the browser.'))

  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canAccessAppLibrary = hasPermission(workspacePermissionKeys, 'app_library.access')

  if (!canAccessAppLibrary) return null

  return <WebAppsSectionContent />
}

export default WebAppsSection
