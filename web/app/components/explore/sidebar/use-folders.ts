import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { get, patch, post, del as httpDel } from '@/service/base'
import Toast from '@/app/components/base/toast'

export type Folder = {
  id: string
  name: string
  appIds: string[]
  isExpanded: boolean
}

type ApiFolderItem = {
  id: string
  name: string
  position: number
}

// ─── API helpers ──────────────────────────────────────────────────────────────
// All paths are relative to /console/api (handled by the base client).

const fetchFolders = (): Promise<{ folders: ApiFolderItem[] }> =>
  get('/explore/folders') as Promise<{ folders: ApiFolderItem[] }>

const apiCreateFolder = (name: string): Promise<ApiFolderItem> =>
  post('/explore/folders', { body: { name } }) as Promise<ApiFolderItem>

const apiRenameFolder = (id: string, name: string): Promise<ApiFolderItem> =>
  patch(`/explore/folders/${id}`, { body: { name } }) as Promise<ApiFolderItem>

const apiDeleteFolder = (id: string): Promise<void> =>
  httpDel(`/explore/folders/${id}`) as Promise<void>

const apiMoveAppToFolder = (installedAppId: string, folderId: string | null): Promise<void> =>
  patch(`/installed-apps/${installedAppId}/folder`, { body: { folder_id: folderId } }) as Promise<void>

// ─── Local-only expanded state (not persisted) ────────────────────────────────
const EXPANDED_KEY = 'explore-folder-expanded'

function loadExpanded(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY)
    return raw ? JSON.parse(raw) : {}
  }
  catch { return {} }
}

function saveExpanded(state: Record<string, boolean>) {
  try { localStorage.setItem(EXPANDED_KEY, JSON.stringify(state)) }
  catch { /* ignore */ }
}

// ─── Main hook ────────────────────────────────────────────────────────────────

/**
 * useFolders – manages explore-sidebar folder state.
 *
 * Folder definitions (name, membership) are persisted via backend API so they
 * survive browser / device switches.  The expanded/collapsed UI state is kept
 * in localStorage only (fine-grained UI preference, not business data).
 *
 * appIds inside each folder is derived from the installedApps list passed by
 * the caller – we store folder_id on InstalledApp on the backend, so the
 * sidebar must pass the installed-app list to rebuild the membership mapping.
 */
export function useFolders(appFolderMap: Record<string, string | null> = {}) {
  const { t } = useTranslation()
  const [folders, setFolders] = useState<Folder[]>([])
  const [expandedState, setExpandedState] = useState<Record<string, boolean>>(loadExpanded)

  // Load folders from backend on mount
  useEffect(() => {
    fetchFolders()
      .then(({ folders: apiFolders }) => {
        const expanded = loadExpanded()
        setFolders(
          apiFolders
            .sort((a, b) => a.position - b.position)
            .map(f => ({
              id: f.id,
              name: f.name,
              // Rebuild appIds from the map the caller provides
              appIds: Object.entries(appFolderMap)
                .filter(([, fId]) => fId === f.id)
                .map(([appId]) => appId),
              isExpanded: expanded[f.id] ?? true,
            })),
        )
      })
      .catch(() => {
        Toast.notify({ type: 'error', message: t('common.api.actionFailed') })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-sync appIds whenever the caller's map changes (e.g., after installedApps reload)
  useEffect(() => {
    setFolders(prev =>
      prev.map(f => ({
        ...f,
        appIds: Object.entries(appFolderMap)
          .filter(([, fId]) => fId === f.id)
          .map(([appId]) => appId),
      })),
    )
  }, [JSON.stringify(appFolderMap)])  // eslint-disable-line react-hooks/exhaustive-deps

  const setExpanded = useCallback((folderId: string, value: boolean) => {
    setExpandedState((prev) => {
      const next = { ...prev, [folderId]: value }
      saveExpanded(next)
      return next
    })
    setFolders(prev => prev.map(f => f.id === folderId ? { ...f, isExpanded: value } : f))
  }, [])

  const createFolder = useCallback(async (name: string): Promise<Folder> => {
    const created = await apiCreateFolder(name)
    const newFolder: Folder = { id: created.id, name: created.name, appIds: [], isExpanded: true }
    setFolders(prev => [...prev, newFolder])
    setExpanded(created.id, true)
    return newFolder
  }, [setExpanded])

  const renameFolder = useCallback(async (folderId: string, newName: string) => {
    await apiRenameFolder(folderId, newName)
    setFolders(prev => prev.map(f => f.id === folderId ? { ...f, name: newName } : f))
  }, [])

  const deleteFolder = useCallback(async (folderId: string) => {
    await apiDeleteFolder(folderId)
    setFolders(prev => prev.filter(f => f.id !== folderId))
  }, [])

  const toggleFolderExpanded = useCallback((folderId: string) => {
    const current = folders.find(f => f.id === folderId)
    if (current)
      setExpanded(folderId, !current.isExpanded)
  }, [folders, setExpanded])

  const moveAppToFolder = useCallback(async (installedAppId: string, folderId: string) => {
    await apiMoveAppToFolder(installedAppId, folderId)
    setFolders(prev =>
      prev.map(f => ({
        ...f,
        appIds: f.id === folderId
          ? [...f.appIds.filter(id => id !== installedAppId), installedAppId]
          : f.appIds.filter(id => id !== installedAppId),
      })),
    )
  }, [])

  const removeAppFromFolder = useCallback(async (installedAppId: string) => {
    await apiMoveAppToFolder(installedAppId, null)
    setFolders(prev =>
      prev.map(f => ({ ...f, appIds: f.appIds.filter(id => id !== installedAppId) })),
    )
  }, [])

  const getAppFolderId = useCallback((appId: string): string | null =>
    folders.find(f => f.appIds.includes(appId))?.id ?? null,
  [folders])

  const isFolderEmpty = useCallback((folderId: string): boolean =>
    (folders.find(f => f.id === folderId)?.appIds.length ?? 0) === 0,
  [folders])

  return {
    folders,
    createFolder,
    renameFolder,
    deleteFolder,
    toggleFolderExpanded,
    moveAppToFolder,
    removeAppFromFolder,
    getAppFolderId,
    isFolderEmpty,
  }
}

