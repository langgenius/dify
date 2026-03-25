'use client'
import { RiAddLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import Link from 'next/link'
import { useSelectedLayoutSegments } from 'next/navigation'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Confirm from '@/app/components/base/confirm'
import Divider from '@/app/components/base/divider'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { useGetInstalledApps, useUninstallApp, useUpdateAppPinStatus } from '@/service/use-explore'
import { cn } from '@/utils/classnames'
import Toast from '../../base/toast'
import Item from './app-nav-item'
import FolderItem from './folder-item'
import MoveToFolderModal from './move-to-folder-modal'
import NoApps from './no-apps'
import { useFolders } from './use-folders'

const SideBar = () => {
  const { t } = useTranslation()
  const segments = useSelectedLayoutSegments()
  const lastSegment = segments.slice(-1)[0]
  const isDiscoverySelected = lastSegment === 'apps'
  const { data, isPending } = useGetInstalledApps()
  const installedApps = data?.installed_apps ?? []
  const { mutateAsync: uninstallApp } = useUninstallApp()
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

  // 文件夹管理 — pass appFolderMap so the hook can reconstruct per-folder appId lists
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

  const [showMoveToFolderModal, setShowMoveToFolderModal] = useState(false)
  const [moveAppId, setMoveAppId] = useState('')

  // 拖动调整宽度相关状态
  const [sidebarWidth, setSidebarWidth] = useState(240)
  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

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

  // 处理拖动开始
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  // 处理拖动中
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing)
      return

    const newWidth = e.clientX
    // 限制最小宽度为 200px，最大宽度为 500px
    if (newWidth >= 200 && newWidth <= 500)
      setSidebarWidth(newWidth)
  }, [isResizing])

  // 处理拖动结束
  const handleMouseUp = useCallback(() => {
    setIsResizing(false)
  }, [])

  // 添加和移除事件监听
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

  const pinnedAppsCount = installedApps.filter(({ is_pinned }) => is_pinned).length

  // 将所有文件夹中的 appId 收集起来
  const folderAppIds = useMemo(() => {
    const ids = new Set<string>()
    folders.forEach(f => f.appIds.forEach(id => ids.add(id)))
    return ids
  }, [folders])

  // 未分组的应用（不在任何文件夹中的）
  const ungroupedApps = useMemo(() =>
    installedApps.filter(app => !folderAppIds.has(app.id)),
  [installedApps, folderAppIds])

  // 渲染单个 app item 的辅助函数
  const renderAppItem = useCallback((
    { id, is_pinned, uninstallable, app: { name, icon_type, icon, icon_url, icon_background } }: typeof installedApps[0],
    isInFolder: boolean,
  ) => (
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
      onDelete={(id) => {
        setCurrId(id)
        setShowConfirm(true)
      }}
      isInFolder={isInFolder}
      onMoveToFolder={() => {
        setMoveAppId(id)
        setShowMoveToFolderModal(true)
      }}
      onRemoveFromFolder={() => removeAppFromFolder(id)}
    />
  ), [isMobile, isFold, lastSegment, handleUpdatePinStatus, removeAppFromFolder])

  return (
    <div
      ref={sidebarRef}
      className={cn('relative shrink-0 cursor-pointer px-3 pt-6', isFold && 'sm:w-[56px]')}
      style={{
        width: isMobile ? 'fit-content' : isFold ? '56px' : `${sidebarWidth}px`,
      }}
    >
      <div className={cn(isDiscoverySelected ? 'text-text-accent' : 'text-text-tertiary')}>
        <Link
          href="/explore/apps"
          className={cn(isDiscoverySelected ? 'bg-state-base-active' : 'hover:bg-state-base-hover', 'flex h-8 items-center gap-2 rounded-lg px-1 mobile:w-fit mobile:justify-center pc:w-full pc:justify-start')}
        >
          <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-components-icon-bg-blue-solid">
            <span className="i-ri-apps-fill size-3.5 text-components-avatar-shape-fill-stop-100" />
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
        <div className="mt-5">
          {!isMobile && !isFold && (
            <div className="mb-1.5 flex items-center justify-between pl-2 mobile:px-0">
              <p className="break-all uppercase text-text-tertiary system-xs-medium-uppercase">{t('sidebar.webApps', { ns: 'explore' })}</p>
              <div
                className="flex size-6 cursor-pointer items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
                title={t('sidebar.folder.new', { ns: 'explore' })}
                onClick={() => createFolder(t('sidebar.folder.defaultName', { ns: 'explore' }))}
              >
                <RiAddLine className="size-3.5" />
              </div>
            </div>
          )}
          <div
            className="space-y-0.5 overflow-y-auto overflow-x-hidden"
            style={{
              height: 'calc(100vh - 250px)',
            }}
          >
            {/* 先渲染置顶的应用 */}
            {ungroupedApps.filter(app => app.is_pinned).map(app => (
              <React.Fragment key={app.id}>
                {renderAppItem(app, false)}
              </React.Fragment>
            ))}
            {pinnedAppsCount > 0 && (ungroupedApps.some(app => !app.is_pinned) || folders.length > 0) && <Divider />}

            {/* 渲染文件夹 */}
            {!isMobile && !isFold && folders.map(folder => (
              <FolderItem
                key={folder.id}
                id={folder.id}
                name={folder.name}
                isExpanded={folder.isExpanded}
                isEmpty={isFolderEmpty(folder.id)}
                onToggleExpand={() => toggleFolderExpanded(folder.id)}
                onRename={(newName) => renameFolder(folder.id, newName)}
                onDelete={() => deleteFolder(folder.id)}
              >
                {folder.appIds
                  .map(appId => installedApps.find(a => a.id === appId))
                  .filter(Boolean)
                  .map(app => renderAppItem(app!, true))}
              </FolderItem>
            ))}

            {/* 渲染未分组的非置顶应用 */}
            {ungroupedApps.filter(app => !app.is_pinned).map(app => (
              <React.Fragment key={app.id}>
                {renderAppItem(app, false)}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {!isMobile && (
        <div className="absolute bottom-3 left-3 flex size-8 cursor-pointer items-center justify-center text-text-tertiary" onClick={toggleIsFold}>
          {isFold
            ? <span className="i-ri-expand-right-line" />
            : (
                <span className="i-ri-layout-left-2-line" />
              )}
        </div>
      )}

      {/* 拖动手柄 */}
      {!isMobile && !isFold && (
        <div
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-divider-regular"
          onMouseDown={handleMouseDown}
          style={{
            backgroundColor: isResizing ? 'rgb(var(--color-divider-regular))' : 'transparent',
          }}
        >
          <div className="absolute right-0 top-0 h-full w-1 hover:w-1" />
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

      {showMoveToFolderModal && (
        <MoveToFolderModal
          folders={folders}
          currentFolderId={getAppFolderId(moveAppId)}
          onSelect={(folderId) => {
            moveAppToFolder(moveAppId, folderId)
            setShowMoveToFolderModal(false)
            Toast.notify({ type: 'success', message: t('api.success', { ns: 'common' }) })
          }}
          onCreateFolder={createFolder}
          onClose={() => setShowMoveToFolderModal(false)}
        />
      )}
    </div>
  )
}

export default React.memo(SideBar)
