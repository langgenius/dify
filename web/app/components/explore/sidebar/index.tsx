'use client'
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
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { toast } from '@langgenius/dify-ui/toast'
import { RiAddLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import Link from '@/next/link'
import { useSelectedLayoutSegments } from '@/next/navigation'
import { useGetInstalledApps, useUninstallApp, useUpdateAppPinStatus } from '@/service/use-explore'
import Item from './app-nav-item'
import FolderItem from './folder-item'
import MoveToFolderModal from './move-to-folder-modal'
import NoApps from './no-apps'
import type { Folder } from './use-folders'
import { useFolders } from './use-folders'

const expandedSidebarScrollAreaClassNames = {
  content: 'space-y-0.5',
  scrollbar: 'data-[orientation=vertical]:my-2 data-[orientation=vertical]:-me-3',
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

  // Build a map of appId -> folderId from the server data so useFolders can
  // reconstruct per-folder appId lists without storing them in localStorage.
  const appFolderMap = useMemo(() => {
    const map: Record<string, string | null> = {}
    installedApps.forEach((app: any) => {
      map[app.id] = app.folder_id ?? null
    })
    return map
  }, [installedApps])

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const [isFold, {
    toggle: toggleIsFold,
  }] = useBoolean(false)

  const [showConfirm, setShowConfirm] = useState(false)
  const [currId, setCurrId] = useState('')

  // Folder management hook – derives folder membership from appFolderMap.
  const {
    folders,
    createFolder,
    renameFolder,
    deleteFolder,
    toggleFolderExpanded,
    moveAppToFolder,
    removeAppFromFolder,
    getAppFolderId,
    isFolderEmpty,
  } = useFolders(appFolderMap)

  // MoveToFolder modal state
  const [showMoveToFolderModal, setShowMoveToFolderModal] = useState(false)
  const [moveAppId, setMoveAppId] = useState('')

  // Sidebar drag-to-resize state.
  const SIDEBAR_MIN_WIDTH = 200
  const SIDEBAR_MAX_WIDTH = 500
  const SIDEBAR_DEFAULT_WIDTH = 240
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing)
      return
    const newWidth = e.clientX
    if (newWidth >= SIDEBAR_MIN_WIDTH && newWidth <= SIDEBAR_MAX_WIDTH)
      setSidebarWidth(newWidth)
  }, [isResizing])

  const handleMouseUp = useCallback(() => {
    setIsResizing(false)
  }, [])

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }
    else {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing, handleMouseMove, handleMouseUp])

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

  // App IDs that already belong to a folder (used to split ungrouped apps).
  const folderAppIds = useMemo(() => {
    const ids = new Set<string>()
    folders.forEach(f => f.appIds.forEach(id => ids.add(id)))
    return ids
  }, [folders])

  // Ungrouped apps (not assigned to any folder).
  const ungroupedApps = useMemo(
    () => installedApps.filter(app => !folderAppIds.has(app.id)),
    [installedApps, folderAppIds],
  )

  const pinnedAppsCount = ungroupedApps.filter(({ is_pinned }) => is_pinned).length

  // Helper: render one app nav item with folder-related handlers.
  const renderAppItem = useCallback(
    ({ id, is_pinned, uninstallable, app: { name, icon_type, icon, icon_url, icon_background } }: typeof installedApps[0], isInFolder: boolean) => (
      <Item
        key={id}
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
        onDelete={(appId) => {
          setCurrId(appId)
          setShowConfirm(true)
        }}
        isInFolder={isInFolder}
        onMoveToFolder={() => {
          setMoveAppId(id)
          setShowMoveToFolderModal(true)
        }}
        onRemoveFromFolder={() => removeAppFromFolder(id)}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isMobile, isFold, lastSegment, removeAppFromFolder],
  )

  // Render folder + ungrouped content (shared between expanded and folded layouts).
  const folderedContent = (
    <>
      {/* Pinned (ungrouped) apps */}
      {ungroupedApps.filter(app => app.is_pinned).map(app => (
        <React.Fragment key={app.id}>
          {renderAppItem(app, false)}
        </React.Fragment>
      ))}
      {(pinnedAppsCount > 0 && (ungroupedApps.some(app => !app.is_pinned) || folders.length > 0)) && <Divider />}

      {/* Folders (only in expanded desktop layout) */}
      {!isMobile && !isFold && folders.map(folder => (
        <FolderItem
          key={folder.id}
          id={folder.id}
          name={folder.name}
          isExpanded={folder.isExpanded}
          isEmpty={isFolderEmpty(folder.id)}
          onToggleExpand={() => toggleFolderExpanded(folder.id)}
          onRename={(newName) => {
            renameFolder(folder.id, newName).catch(() => {
              toast.error(t('common.api.actionFailed'))
            })
          }}
          onDelete={() => {
            deleteFolder(folder.id).catch(() => {
              toast.error(t('common.api.actionFailed'))
            })
          }}
        >
          {folder.appIds
            .map(appId => installedApps.find(a => a.id === appId))
            .filter(Boolean)
            .sort((a, b) => (b!.is_pinned ? 1 : 0) - (a!.is_pinned ? 1 : 0))
            .map(app => renderAppItem(app!, true))}
        </FolderItem>
      ))}

      {/* Ungrouped non-pinned apps */}
      {ungroupedApps.filter(app => !app.is_pinned).map(app => (
        <React.Fragment key={app.id}>
          {renderAppItem(app, false)}
        </React.Fragment>
      ))}
    </>
  )

  const shouldUseExpandedScrollArea = !isMobile && !isFold
  const webAppsLabelId = React.useId()

  return (
    <div
      ref={sidebarRef}
      className={cn('relative flex h-full shrink-0 cursor-pointer flex-col px-3 pt-6', isFold && 'sm:w-[56px]')}
      style={{
        width: isMobile
          ? 'fit-content'
          : isFold
            ? '56px'
            : `${sidebarWidth}px`,
      }}
    >
      <div className={cn(isDiscoverySelected ? 'text-text-accent' : 'text-text-tertiary')}>
        <Link
          href="/explore/apps"
          aria-label={isMobile || isFold ? t('sidebar.title', { ns: 'explore' }) : undefined}
          className={cn(isDiscoverySelected ? 'bg-state-base-active' : 'hover:bg-state-base-hover', 'flex h-8 items-center gap-2 rounded-lg px-1 mobile:w-fit mobile:justify-center pc:w-full pc:justify-start')}
        >
          <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-components-icon-bg-blue-solid">
            <span aria-hidden="true" className="i-ri-apps-fill size-3.5 text-components-avatar-shape-fill-stop-100" />
          </div>
          {!isMobile && !isFold && <div className={cn('truncate', isDiscoverySelected ? 'system-sm-semibold text-components-menu-item-text-active' : 'system-sm-regular text-components-menu-item-text')}>{t('sidebar.title', { ns: 'explore' })}</div>}
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
          {!isMobile && !isFold
          && (
            <div className="mb-1.5 flex items-center justify-between pl-2 mobile:px-0">
              <p id={webAppsLabelId} className="system-xs-medium-uppercase break-all uppercase text-text-tertiary">{t('sidebar.webApps', { ns: 'explore' })}</p>
              <div
                className="flex size-6 cursor-pointer items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
                title={t('sidebar.folder.new', { ns: 'explore' })}
                onClick={() => {
                  createFolder(t('sidebar.folder.defaultName', { ns: 'explore' })).catch(() => {
                    toast.error(t('common.api.actionFailed'))
                  })
                }}
              >
                <RiAddLine className="size-3.5" />
              </div>
            </div>
          )}
          {shouldUseExpandedScrollArea
            ? (
                <div className="min-h-0 flex-1">
                  <ScrollArea
                    className="h-full"
                    slotClassNames={expandedSidebarScrollAreaClassNames}
                    labelledBy={webAppsLabelId}
                  >
                    {folderedContent}
                  </ScrollArea>
                </div>
              )
            : (
                <div className="h-full min-h-0 flex-1 space-y-0.5 overflow-x-hidden overflow-y-auto">
                  {folderedContent}
                </div>
              )}
        </div>
      )}

      {!isMobile && (
        <div className="mt-auto flex pt-3 pb-3">
          <button
            type="button"
            aria-label={isFold ? t('sidebar.expandSidebar', { ns: 'layout' }) : t('sidebar.collapseSidebar', { ns: 'layout' })}
            className="flex size-8 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-hover focus-visible:outline-hidden focus-visible:ring-inset"
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

      {/* Drag handle for resizing sidebar width (desktop, expanded only) */}
      {!isMobile && !isFold && (
        <div
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-divider-regular"
          onMouseDown={handleMouseDown}
          style={{
            backgroundColor: isResizing ? 'rgb(var(--color-divider-regular))' : 'transparent',
          }}
        />
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

      {showMoveToFolderModal && (
        <MoveToFolderModal
          folders={folders}
          currentFolderId={getAppFolderId(moveAppId)}
          onSelect={(folderId) => {
            moveAppToFolder(moveAppId, folderId)
              .then(() => {
                setShowMoveToFolderModal(false)
                toast.success(t('api.success', { ns: 'common' }))
              })
              .catch(() => {
                toast.error(t('common.api.actionFailed'))
              })
          }}
          onCreateFolder={async (name: string) => {
            try {
              return await createFolder(name)
            }
            catch {
              toast.error(t('common.api.actionFailed'))
              throw new Error('create folder failed')
            }
          }}
          onClose={() => setShowMoveToFolderModal(false)}
        />
      )}
    </div>
  )
}

export default React.memo(SideBar)
