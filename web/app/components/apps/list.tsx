'use client'

import type { GetAppsData } from '@dify/contracts/api/console/apps/types.gen'
import type { AppListCreationDialog } from './app-list-creation-modals'
import type { AppListUrlQuery } from './query-params'
import type { App } from '@/models/explore'
import type { TryAppSelection } from '@/types/try-app'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { useDebounce } from 'ahooks'
import { useAtomValue } from 'jotai'
import { useQueryStates } from 'nuqs'
import { useCallback, useId, useMemo, useRef, useState } from 'react'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { CheckModal } from '@/hooks/use-pay'
import { hasPermission } from '@/utils/permission'
import { AppListCatalog } from './app-list-catalog'
import { AppListCreationModals } from './app-list-creation-modals'
import { AppListHeader } from './app-list-header'
import { AppListTagManagementModal } from './app-list-tag-management-modal'
import { APP_LIST_SEARCH_DEBOUNCE_MS } from './constants'
import { useDSLDragDrop } from './hooks/use-dsl-drag-drop'
import { appListQueryParsers } from './query-params'

type AppListQuery = NonNullable<GetAppsData['query']>
type AppListSortBy = NonNullable<AppListQuery['sort_by']>
type AppListCategory = AppListUrlQuery['category']

type Props = Readonly<{
  onCreateLearnDify?: (app: App) => void
  onTryLearnDify?: (params: TryAppSelection) => void
}>

export function List({ onCreateLearnDify, onTryLearnDify }: Props) {
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)

  const [urlQuery, setUrlQuery] = useQueryStates(appListQueryParsers)
  const { category, keywords } = urlQuery
  const [creatorIDs, setCreatorIDs] = useState<string[]>([])
  const [tagIDs, setTagIDs] = useState<string[]>([])
  const [sortBy, setSortBy] = useState<AppListSortBy>('last_modified')
  const debouncedKeywords = useDebounce(keywords, { wait: APP_LIST_SEARCH_DEBOUNCE_MS })
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const scrollViewportRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const [showTagManagementModal, setShowTagManagementModal] = useState(false)
  const [creationDialog, setCreationDialog] = useState<AppListCreationDialog>(null)
  const canCreateApp = hasPermission(workspacePermissionKeys, 'app.create_and_management')
  const hasActiveFilters =
    category !== 'all' ||
    tagIDs.length > 0 ||
    keywords.trim().length > 0 ||
    debouncedKeywords.trim().length > 0 ||
    creatorIDs.length > 0

  const handleDSLFileDropped = useCallback(
    (file: File) => {
      if (!canCreateApp) return

      setCreationDialog({ type: 'dsl', droppedFile: file })
    },
    [canCreateApp],
  )

  const { dragging } = useDSLDragDrop({
    onDSLFileDropped: handleDSLFileDropped,
    dropZoneRef,
    enabled: canCreateApp,
  })

  const appListQuery = useMemo<AppListQuery>(
    () => ({
      page: 1,
      limit: 30,
      name: debouncedKeywords,
      sort_by: sortBy,
      ...(tagIDs.length ? { tag_ids: tagIDs } : {}),
      ...(creatorIDs.length ? { creator_ids: creatorIDs } : {}),
      ...(category !== 'all' ? { mode: category } : {}),
    }),
    [category, creatorIDs, debouncedKeywords, sortBy, tagIDs],
  )

  const resetCatalogScroll = () => {
    scrollViewportRef.current?.scrollTo({ top: 0 })
  }
  const changeCategory = (nextCategory: AppListCategory) => {
    resetCatalogScroll()
    void setUrlQuery({ category: nextCategory })
  }
  const changeTagIDs = (nextTagIDs: string[]) => {
    resetCatalogScroll()
    setTagIDs(nextTagIDs)
  }
  const changeKeywords = (nextKeywords: string) => {
    resetCatalogScroll()
    void setUrlQuery({ keywords: nextKeywords })
  }
  const changeCreatorIDs = (nextCreatorIDs: string[]) => {
    resetCatalogScroll()
    setCreatorIDs(nextCreatorIDs)
  }
  const changeSortBy = (nextSortBy: AppListSortBy) => {
    resetCatalogScroll()
    setSortBy(nextSortBy)
  }

  const openCreateBlankModal = useCallback(() => {
    if (canCreateApp) setCreationDialog({ type: 'blank' })
  }, [canCreateApp])
  const openCreateTemplateDialog = useCallback(() => {
    if (canCreateApp) setCreationDialog({ type: 'template' })
  }, [canCreateApp])
  const openCreateFromDSLModal = useCallback(() => {
    if (canCreateApp) setCreationDialog({ type: 'dsl' })
  }, [canCreateApp])
  const openTagManagement = useCallback(() => setShowTagManagementModal(true), [])

  return (
    <>
      <div
        ref={dropZoneRef}
        className="relative flex h-0 min-h-0 shrink-0 grow flex-col bg-background-body"
      >
        {dragging && (
          <div className="absolute inset-0 z-50 m-0.5 rounded-2xl border-2 border-dashed border-components-dropzone-border-accent bg-[rgba(21,90,239,0.14)] p-2"></div>
        )}

        <AppListHeader
          titleId={titleId}
          category={category}
          tagIDs={tagIDs}
          keywords={keywords}
          creatorIDs={creatorIDs}
          sortBy={sortBy}
          onCategoryChange={changeCategory}
          onTagIDsChange={changeTagIDs}
          onKeywordsChange={changeKeywords}
          onCreatorIDsChange={changeCreatorIDs}
          onSortByChange={changeSortBy}
          onCreateBlank={openCreateBlankModal}
          onCreateTemplate={openCreateTemplateDialog}
          onImportDSL={openCreateFromDSLModal}
          onOpenTagManagement={openTagManagement}
          showCreateButton={canCreateApp}
        />

        <div className="relative min-h-0 grow">
          <ScrollArea className="size-full overflow-hidden">
            <ScrollAreaViewport
              ref={scrollViewportRef}
              role="region"
              aria-labelledby={titleId}
              className="overscroll-contain"
              style={{ overflowX: 'hidden' }}
            >
              <ScrollAreaContent
                className="flex min-h-full w-full max-w-full min-w-0 flex-col"
                style={{ minWidth: 0 }}
              >
                <AppListCatalog
                  appListQuery={appListQuery}
                  canCreateApp={canCreateApp}
                  dragging={dragging}
                  hasActiveFilters={hasActiveFilters}
                  onCreateBlank={openCreateBlankModal}
                  onCreateLearnDify={onCreateLearnDify}
                  onCreateTemplate={openCreateTemplateDialog}
                  onImportDSL={openCreateFromDSLModal}
                  onOpenTagManagement={openTagManagement}
                  onTryLearnDify={onTryLearnDify}
                  scrollViewportRef={scrollViewportRef}
                />
              </ScrollAreaContent>
            </ScrollAreaViewport>
            <ScrollAreaScrollbar>
              <ScrollAreaThumb />
            </ScrollAreaScrollbar>
          </ScrollArea>
        </div>

        <CheckModal />
        <AppListTagManagementModal
          show={showTagManagementModal}
          onClose={() => setShowTagManagementModal(false)}
        />
      </div>

      <AppListCreationModals
        canCreateApp={canCreateApp}
        category={category}
        dialog={creationDialog}
        onClose={() => setCreationDialog(null)}
        onOpenBlank={openCreateBlankModal}
        onOpenTemplate={openCreateTemplateDialog}
      />
    </>
  )
}
