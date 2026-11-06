'use client'

import type { GetAppsData } from '@dify/contracts/api/console/apps/types.gen'
import type { RecommendedAppResponse } from '@dify/contracts/api/console/explore/types.gen'
import type { AppListCreationDialog } from './app-list-creation-modals'
import type { AppListUrlQuery } from './query-params'
import { useDebounce } from 'ahooks'
import { useAtom, useAtomValue } from 'jotai'
import { throttle, useQueryStates } from 'nuqs'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { CheckResultToast } from '@/hooks/use-pay'
import { hasPermission } from '@/utils/permission'
import { basePath } from '@/utils/var'
import { AppListCatalog } from './app-list-catalog'
import { AppListCreationModals } from './app-list-creation-modals'
import { AppListHeader } from './app-list-header'
import { AppListTagManagementModal } from './app-list-tag-management-modal'
import { APP_LIST_SEARCH_DEBOUNCE_MS } from './constants'
import { templateDialogRequestedAtom } from './creation-requests'
import { useDSLDragDrop } from './hooks/use-dsl-drag-drop'
import { StudioListNavigation } from './list-navigation'
import {
  appListQueryParsers,
  createAppModeQueryParser,
  createAppPath,
  getCreateAppHref,
  serializeAppListQuery,
} from './query-params'

type AppListQuery = NonNullable<GetAppsData['query']>
type AppListSortBy = NonNullable<AppListQuery['sort_by']>
type AppListCategory = AppListUrlQuery['category']

const isCreateAppLocation = () => window.location.pathname === `${basePath}${createAppPath}`
const leaveCreateAppLocation = () => {
  if (isCreateAppLocation()) window.history.back()
}

type Props = Readonly<{
  onCreateLearnDify?: (app: RecommendedAppResponse) => void
  onTryLearnDify?: (app: RecommendedAppResponse) => void
}>

export function List({ onCreateLearnDify, onTryLearnDify }: Props) {
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)

  const [urlQuery, setUrlQuery] = useQueryStates(appListQueryParsers)
  const { category, keywords, creatorIDs, tagIDs, sort_by: sortBy } = urlQuery
  const debouncedKeywords = useDebounce(keywords, { wait: APP_LIST_SEARCH_DEBOUNCE_MS })
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const scrollViewportRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const [showTagManagementModal, setShowTagManagementModal] = useState(false)
  const [creationDialog, setCreationDialog] = useState<AppListCreationDialog>(null)
  const [isTemplateDialogRequested, setIsTemplateDialogRequested] = useAtom(
    templateDialogRequestedAtom,
  )
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
    void setUrlQuery({ tagIDs: nextTagIDs })
  }
  const changeKeywords = (nextKeywords: string) => {
    resetCatalogScroll()
    void setUrlQuery({ keywords: nextKeywords })
  }
  const changeCreatorIDs = (nextCreatorIDs: string[]) => {
    resetCatalogScroll()
    void setUrlQuery({ creatorIDs: nextCreatorIDs })
  }
  const changeSortBy = (nextSortBy: AppListSortBy) => {
    resetCatalogScroll()
    void setUrlQuery({ sort_by: nextSortBy })
  }

  // Blank creation owns `/apps/create`. From the Studio it is a shallow URL over
  // the mounted list; visited directly, the route renders it on its own.
  const openCreateBlankModal = useCallback(() => {
    if (!canCreateApp) return
    const mode = category === 'all' ? undefined : category
    setIsTemplateDialogRequested(false)
    setCreationDialog({ type: 'blank', category: mode })
    window.history.pushState(window.history.state, '', `${basePath}${getCreateAppHref(mode)}`)
  }, [canCreateApp, category, setIsTemplateDialogRequested])
  const openCreateTemplateDialog = useCallback(() => {
    if (!canCreateApp) return
    setCreationDialog({ type: 'template' })
    leaveCreateAppLocation()
  }, [canCreateApp])
  const closeCreationDialog = useCallback(() => {
    setCreationDialog(null)
    setIsTemplateDialogRequested(false)
    leaveCreateAppLocation()
  }, [setIsTemplateDialogRequested])
  useEffect(() => {
    const syncBlankCreationWithLocation = () => {
      if (!isCreateAppLocation()) {
        setCreationDialog((current) => (current?.type === 'blank' ? null : current))
        return
      }
      const mode = new URLSearchParams(window.location.search).get('mode')
      setCreationDialog({
        type: 'blank',
        category: (mode && createAppModeQueryParser.parse(mode)) || undefined,
      })
    }
    window.addEventListener('popstate', syncBlankCreationWithLocation)
    return () => window.removeEventListener('popstate', syncBlankCreationWithLocation)
  }, [])
  const openCreateFromDSLModal = useCallback(() => {
    if (canCreateApp) setCreationDialog({ type: 'dsl' })
  }, [canCreateApp])
  const openTagManagement = useCallback(() => setShowTagManagementModal(true), [])

  return (
    <StudioListNavigation
      path="/apps"
      href={serializeAppListQuery('/apps', urlQuery)}
      flush={() => setUrlQuery(urlQuery, { history: 'replace', limitUrlUpdates: throttle(0) })}
    >
      <div
        ref={dropZoneRef}
        className="relative flex h-0 min-h-0 shrink-0 grow flex-col bg-background-body"
      >
        {dragging && (
          <div className="absolute inset-0 z-50 m-0.5 rounded-2xl border-2 border-dashed border-components-dropzone-border-accent bg-[rgba(21,90,239,0.14)] p-2"></div>
        )}

        <div
          ref={scrollViewportRef}
          role="region"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="flex min-h-0 grow flex-col overflow-x-hidden overflow-y-auto overscroll-contain outline-hidden"
        >
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
        </div>

        <CheckResultToast />
        <AppListTagManagementModal
          show={showTagManagementModal}
          onClose={() => setShowTagManagementModal(false)}
        />
      </div>

      <AppListCreationModals
        canCreateApp={canCreateApp}
        category={category}
        dialog={
          creationDialog ??
          (canCreateApp && isTemplateDialogRequested ? { type: 'template' } : null)
        }
        onClose={closeCreationDialog}
        onOpenBlank={openCreateBlankModal}
        onOpenTemplate={openCreateTemplateDialog}
      />
    </StudioListNavigation>
  )
}
