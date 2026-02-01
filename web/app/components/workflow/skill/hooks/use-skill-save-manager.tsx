import { useQueryClient } from '@tanstack/react-query'
import { useEventListener } from 'ahooks'
import isDeepEqual from 'fast-deep-equal'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { extractToolConfigIds } from '@/app/components/workflow/utils'
import { useSystemFeatures } from '@/hooks/use-global-public'
import { consoleQuery } from '@/service/client'
import { useUpdateAppAssetFileContent } from '@/service/use-app-asset'
import { skillCollaborationManager } from '../../collaboration/skills/skill-collaboration-manager'
import { START_TAB_ID } from '../constants'

type SaveSnapshot = {
  content: string
  metadata?: Record<string, unknown>
  hasDraftContent: boolean
  hasMetadataDirty: boolean
}

type CachedFileContent = {
  content?: string
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

export type SaveFileOptions = {
  fallbackContent?: string
  fallbackMetadata?: Record<string, unknown>
}

export type SaveResult = {
  saved: boolean
  error?: unknown
}

export type FallbackEntry = {
  content: string
  metadata?: Record<string, unknown>
}

type SkillSaveContextValue = {
  saveFile: (fileId: string, options?: SaveFileOptions) => Promise<SaveResult>
  saveAllDirty: () => void
  registerFallback: (fileId: string, entry: FallbackEntry) => void
  unregisterFallback: (fileId: string) => void
}

type SkillSaveProviderProps = {
  appId: string
  children: React.ReactNode
}

const normalizeMetadata = (
  rawMetadata: Record<string, unknown> | undefined,
  content: string,
): Record<string, unknown> | undefined => {
  if (!rawMetadata || typeof rawMetadata !== 'object' || !('tools' in rawMetadata))
    return rawMetadata

  const toolIds = extractToolConfigIds(content)
  const rawTools = (rawMetadata as Record<string, unknown>).tools
  if (!rawTools || typeof rawTools !== 'object')
    return rawMetadata

  const entries = Object.entries(rawTools as Record<string, unknown>)
  const nextTools = entries.reduce<Record<string, unknown>>((acc, [id, value]) => {
    if (toolIds.has(id))
      acc[id] = value
    return acc
  }, {})
  const nextMetadata = { ...(rawMetadata as Record<string, unknown>) }
  if (Object.keys(nextTools).length > 0)
    nextMetadata.tools = nextTools
  else
    delete nextMetadata.tools
  return nextMetadata
}

const SkillSaveContext = React.createContext<SkillSaveContextValue | null>(null)

export const SkillSaveProvider = ({
  appId,
  children,
}: SkillSaveProviderProps) => {
  const { t } = useTranslation()
  const storeApi = useWorkflowStore()
  const queryClient = useQueryClient()
  const updateContent = useUpdateAppAssetFileContent()
  const isCollaborationEnabled = useSystemFeatures().enable_collaboration_mode
  const queueRef = useRef<Map<string, Promise<SaveResult>>>(new Map())
  const fallbackRegistryRef = useRef<Map<string, FallbackEntry>>(new Map())

  const getCachedContent = useCallback((fileId: string): string | undefined => {
    if (!appId)
      return undefined

    const cached = queryClient.getQueryData<CachedFileContent>(
      consoleQuery.appAsset.getFileContent.queryKey({
        input: { params: { appId, nodeId: fileId } },
      }),
    )

    const rawContent = cached?.content
    if (!rawContent)
      return undefined

    try {
      const parsed = JSON.parse(rawContent) as { content?: unknown }
      if (parsed && typeof parsed === 'object' && typeof parsed.content === 'string')
        return parsed.content
    }
    catch {
      // Fall back to raw content when it's not a JSON wrapper.
    }

    return rawContent
  }, [appId, queryClient])

  const buildSnapshot = useCallback((
    fileId: string,
    fallbackContent?: string,
    fallbackMetadata?: Record<string, unknown>,
  ): SaveSnapshot | null => {
    const state = storeApi.getState()
    const draftContent = state.dirtyContents.get(fileId)
    const isMetadataDirty = state.dirtyMetadataIds.has(fileId)

    if (draftContent === undefined && !isMetadataDirty)
      return null

    const registryEntry = fallbackRegistryRef.current.get(fileId)
    const rawMetadata = state.fileMetadata.get(fileId) ?? fallbackMetadata ?? registryEntry?.metadata
    const content = draftContent ?? getCachedContent(fileId) ?? fallbackContent ?? registryEntry?.content

    if (content === undefined)
      return null

    const metadata = normalizeMetadata(rawMetadata, content)

    return {
      content,
      metadata,
      hasDraftContent: draftContent !== undefined,
      hasMetadataDirty: isMetadataDirty,
    }
  }, [getCachedContent, storeApi])

  const updateCachedContent = useCallback((fileId: string, snapshot: SaveSnapshot) => {
    if (!appId)
      return

    const queryKey = consoleQuery.appAsset.getFileContent.queryKey({
      input: { params: { appId, nodeId: fileId } },
    })
    const existing = queryClient.getQueryData<CachedFileContent>(queryKey)
    const serialized = JSON.stringify({
      content: snapshot.content,
      ...(snapshot.metadata ? { metadata: snapshot.metadata } : {}),
    })
    const nextData: CachedFileContent & { content: string } = {
      ...(existing && typeof existing === 'object' ? existing : {}),
      content: serialized,
    }

    queryClient.setQueryData(queryKey, nextData)
  }, [appId, queryClient])

  const performSave = useCallback(async (
    fileId: string,
    options?: SaveFileOptions,
  ): Promise<SaveResult> => {
    if (!appId || !fileId || fileId === START_TAB_ID)
      return { saved: false }

    if (isCollaborationEnabled && skillCollaborationManager.isFileCollaborative(fileId) && !skillCollaborationManager.isLeader(fileId)) {
      skillCollaborationManager.requestSync(fileId)
      return { saved: false }
    }

    const snapshot = buildSnapshot(fileId, options?.fallbackContent, options?.fallbackMetadata)
    if (!snapshot) {
      return { saved: false }
    }

    try {
      await updateContent.mutateAsync({
        appId,
        nodeId: fileId,
        payload: {
          content: snapshot.content,
          ...(snapshot.metadata ? { metadata: snapshot.metadata } : {}),
        },
      })

      updateCachedContent(fileId, snapshot)

      const latestState = storeApi.getState()
      if (snapshot.hasDraftContent) {
        const latestDraft = latestState.dirtyContents.get(fileId)
        if (latestDraft === snapshot.content)
          latestState.clearDraftContent(fileId)
      }

      if (snapshot.hasMetadataDirty) {
        const latestMetadata = latestState.fileMetadata.get(fileId)
        const normalizedLatest = normalizeMetadata(latestMetadata, snapshot.content)
        if (isDeepEqual(normalizedLatest, snapshot.metadata))
          latestState.clearDraftMetadata(fileId)
      }

      if (isCollaborationEnabled && skillCollaborationManager.isFileCollaborative(fileId)) {
        skillCollaborationManager.emitFileSaved(fileId, snapshot.content, snapshot.metadata)
      }

      return { saved: true }
    }
    catch (error) {
      return { saved: false, error }
    }
  }, [appId, buildSnapshot, isCollaborationEnabled, storeApi, updateCachedContent, updateContent])

  const saveFile = useCallback(async (
    fileId: string,
    options?: SaveFileOptions,
  ): Promise<SaveResult> => {
    if (!fileId || fileId === START_TAB_ID)
      return { saved: false }

    const previous = queueRef.current.get(fileId) || Promise.resolve({ saved: false })
    const next = previous.then(() => performSave(fileId, options))
    queueRef.current.set(fileId, next)
    return next.finally(() => {
      if (queueRef.current.get(fileId) === next)
        queueRef.current.delete(fileId)
    })
  }, [performSave])

  const saveAllDirty = useCallback(() => {
    if (!appId)
      return

    const { dirtyContents, dirtyMetadataIds } = storeApi.getState()
    if (dirtyContents.size === 0 && dirtyMetadataIds.size === 0)
      return

    const dirtyIds = new Set<string>()
    dirtyContents.forEach((_value, fileId) => {
      dirtyIds.add(fileId)
    })
    dirtyMetadataIds.forEach((fileId) => {
      dirtyIds.add(fileId)
    })

    const tasks = Array.from(dirtyIds)
      .filter(fileId => fileId !== START_TAB_ID)
      .map(fileId => saveFile(fileId))

    if (tasks.length === 0)
      return

    void Promise.allSettled(tasks)
  }, [appId, saveFile, storeApi])

  const registerFallback = useCallback((fileId: string, entry: FallbackEntry) => {
    fallbackRegistryRef.current.set(fileId, entry)
  }, [])

  const unregisterFallback = useCallback((fileId: string) => {
    fallbackRegistryRef.current.delete(fileId)
  }, [])

  useEventListener('keydown', (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      const { activeTabId } = storeApi.getState()
      if (!activeTabId || activeTabId === START_TAB_ID)
        return

      const fallback = fallbackRegistryRef.current.get(activeTabId)
      void saveFile(activeTabId, {
        fallbackContent: fallback?.content,
        fallbackMetadata: fallback?.metadata,
      }).then((result) => {
        if (result.error) {
          const errorMessage = result.error instanceof Error
            ? result.error.message
            : String(result.error)
          Toast.notify({ type: 'error', message: errorMessage })
        }
        else if (result.saved) {
          Toast.notify({ type: 'success', message: t('api.saved', { ns: 'common' }) })
        }
      })
    }
  }, { target: typeof window !== 'undefined' ? window : undefined })

  const value = useMemo<SkillSaveContextValue>(() => ({
    saveFile,
    saveAllDirty,
    registerFallback,
    unregisterFallback,
  }), [saveAllDirty, saveFile, registerFallback, unregisterFallback])

  useEffect(() => {
    if (!appId || !isCollaborationEnabled)
      return

    return skillCollaborationManager.onAnyFileSaved((payload) => {
      if (!payload?.file_id || typeof payload.content !== 'string')
        return

      const fileId = payload.file_id
      const queryKey = consoleQuery.appAsset.getFileContent.queryKey({
        input: { params: { appId, nodeId: fileId } },
      })
      const serialized = JSON.stringify({
        content: payload.content,
        ...(payload.metadata ? { metadata: payload.metadata } : {}),
      })
      const existing = queryClient.getQueryData<CachedFileContent>(queryKey)
      queryClient.setQueryData(queryKey, {
        ...(existing && typeof existing === 'object' ? existing : {}),
        content: serialized,
      })

      const state = storeApi.getState()
      state.clearDraftContent(fileId)

      const latestMetadata = state.fileMetadata.get(fileId)
      const normalizedLatest = normalizeMetadata(latestMetadata, payload.content)
      if (payload.metadata === undefined || isDeepEqual(normalizedLatest, payload.metadata))
        state.clearDraftMetadata(fileId)
    })
  }, [appId, isCollaborationEnabled, queryClient, storeApi])

  return (
    <SkillSaveContext.Provider value={value}>
      {children}
    </SkillSaveContext.Provider>
  )
}

export const useSkillSaveManager = () => {
  const context = React.useContext(SkillSaveContext)
  if (!context)
    throw new Error('Missing SkillSaveProvider in the tree')

  return context
}
