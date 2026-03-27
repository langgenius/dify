import type { SkillFileDataMode } from '../../../hooks/use-skill-file-data'
import type { FileContentControllerState } from './types'
import type { SkillFileMetadata } from './utils'
import type { AppAssetTreeView } from '@/types/app-asset'
import isDeepEqual from 'fast-deep-equal'
import { useCallback, useRef } from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useSkillCodeCollaboration } from '../../../../collaboration/skills/use-skill-code-collaboration'
import { useSkillMarkdownCollaboration } from '../../../../collaboration/skills/use-skill-markdown-collaboration'
import { START_TAB_ID } from '../../../constants'
import { useSkillAssetNodeMap } from '../../../hooks/file-tree/data/use-skill-asset-tree'
import { useSkillSaveManager } from '../../../hooks/skill-save-context'
import { useFileNodeViewState as useFileNodeStatus } from '../../../hooks/use-file-node-view-state'
import { useFileTypeInfo } from '../../../hooks/use-file-type-info'
import { useSkillFileData } from '../../../hooks/use-skill-file-data'
import { useFileFallbackLifecycle } from './use-file-fallback-lifecycle'
import { useFileMetadataSync } from './use-file-metadata-sync'
import { extractFileReferenceIds } from './utils'

export const useFileContentController = (): FileContentControllerState => {
  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''
  const isCollaborationEnabled = useGlobalPublicStore(s => s.systemFeatures.enable_collaboration_mode)
  const activeTabId = useStore(s => s.activeTabId)
  const editorAutoFocusFileId = useStore(s => s.editorAutoFocusFileId)
  const storeApi = useWorkflowStore()
  const {
    data: nodeMap,
    isLoading: isNodeMapLoading,
    isFetching: isNodeMapFetching,
    isFetched: isNodeMapFetched,
  } = useSkillAssetNodeMap()

  const isStartTab = activeTabId === START_TAB_ID
  const fileTabId = isStartTab ? null : activeTabId

  const draftContent = useStore(s => fileTabId ? s.dirtyContents.get(fileTabId) : undefined)
  const currentMetadata = useStore(s => fileTabId ? s.fileMetadata.get(fileTabId) : undefined)
  const isMetadataDirty = useStore(s => fileTabId ? s.dirtyMetadataIds.has(fileTabId) : false)

  const currentFileNode = fileTabId ? nodeMap?.get(fileTabId) : undefined
  const shouldAutoFocusEditor = Boolean(fileTabId && editorAutoFocusFileId === fileTabId)
  const nodeViewStatus = useFileNodeStatus({
    fileTabId,
    hasCurrentFileNode: Boolean(currentFileNode),
    isNodeMapLoading,
    isNodeMapFetching,
    isNodeMapFetched,
  })
  const isNodeReady = nodeViewStatus === 'ready'
  const {
    isMarkdown,
    isCodeOrText,
    isImage,
    isVideo,
    isPdf,
    isSQLite,
    isEditable,
  } = useFileTypeInfo(isNodeReady ? currentFileNode : undefined)
  const fileDataMode: SkillFileDataMode = !fileTabId || !isNodeReady
    ? 'none'
    : isEditable
      ? 'content'
      : 'download'

  const { fileContent, downloadUrlData, isLoading, error } = useSkillFileData(appId, fileTabId, fileDataMode)
  const originalContent = fileContent?.content ?? ''
  const currentContent = draftContent !== undefined ? draftContent : originalContent
  const initialContentRegistryRef = useRef<Map<string, string>>(new Map())
  const canInitCollaboration = Boolean(isCollaborationEnabled && appId && fileTabId && isEditable && !isLoading && !error)

  if (canInitCollaboration && fileTabId && !initialContentRegistryRef.current.has(fileTabId))
    initialContentRegistryRef.current.set(fileTabId, currentContent)

  const initialCollaborativeContent = fileTabId
    ? (initialContentRegistryRef.current.get(fileTabId) ?? currentContent)
    : ''

  useFileMetadataSync({
    fileTabId,
    hasLoadedContent: fileContent !== undefined,
    metadataSource: fileContent?.metadata,
    isMetadataDirty,
    storeApi,
  })

  const updateFileReferenceMetadata = useCallback((content: string) => {
    if (!fileTabId)
      return false

    const referenceIds = extractFileReferenceIds(content)
    const metadata = (currentMetadata || {}) as SkillFileMetadata
    const existingFiles = metadata.files || {}
    const nextFiles: Record<string, AppAssetTreeView> = {}

    referenceIds.forEach((id) => {
      const node = nodeMap?.get(id)
      if (node)
        nextFiles[id] = node
      else if (existingFiles[id])
        nextFiles[id] = existingFiles[id]
    })

    const nextMetadata: SkillFileMetadata = { ...metadata }
    if (Object.keys(nextFiles).length > 0)
      nextMetadata.files = nextFiles
    else if ('files' in nextMetadata)
      delete nextMetadata.files

    if (isDeepEqual(metadata, nextMetadata))
      return false

    storeApi.getState().setDraftMetadata(fileTabId, nextMetadata)
    return true
  }, [currentMetadata, fileTabId, nodeMap, storeApi])

  const applyContentChange = useCallback((
    value: string | undefined,
    options?: {
      pinWhenContentMatchesOriginal?: boolean
    },
  ) => {
    if (!fileTabId || !isEditable)
      return

    const nextValue = value ?? ''
    const state = storeApi.getState()

    if (nextValue === originalContent)
      state.clearDraftContent(fileTabId)
    else
      state.setDraftContent(fileTabId, nextValue)

    const didUpdateMetadata = updateFileReferenceMetadata(nextValue)
    if (nextValue !== originalContent || didUpdateMetadata || options?.pinWhenContentMatchesOriginal)
      state.pinTab(fileTabId)
  }, [fileTabId, isEditable, originalContent, storeApi, updateFileReferenceMetadata])

  const handleLocalContentChange = useCallback((value: string | undefined) => {
    applyContentChange(value, { pinWhenContentMatchesOriginal: true })
  }, [applyContentChange])

  const handleRemoteContentChange = useCallback((value: string) => {
    applyContentChange(value)
  }, [applyContentChange])

  const { saveFile, registerFallback, unregisterFallback } = useSkillSaveManager()
  const handleLeaderSync = useCallback(() => {
    if (!fileTabId || !isEditable)
      return
    void saveFile(fileTabId)
  }, [fileTabId, isEditable, saveFile])

  useFileFallbackLifecycle({
    fileTabId,
    isEditable,
    hasLoadedContent: fileContent?.content !== undefined,
    originalContent,
    currentMetadata,
    saveFile,
    registerFallback,
    unregisterFallback,
  })

  const handleEditorAutoFocus = useCallback(() => {
    if (!fileTabId)
      return
    storeApi.getState().clearEditorAutoFocus(fileTabId)
  }, [fileTabId, storeApi])

  const { handleCollaborativeChange: handleMarkdownCollaborativeChange } = useSkillMarkdownCollaboration({
    appId,
    fileId: fileTabId,
    enabled: canInitCollaboration && isMarkdown,
    initialContent: initialCollaborativeContent,
    baselineContent: originalContent,
    onLocalChange: handleLocalContentChange,
    onRemoteChange: handleRemoteContentChange,
    onLeaderSync: handleLeaderSync,
  })
  const { handleCollaborativeChange: handleCodeCollaborativeChange } = useSkillCodeCollaboration({
    appId,
    fileId: fileTabId,
    enabled: canInitCollaboration && isCodeOrText,
    initialContent: initialCollaborativeContent,
    baselineContent: originalContent,
    onLocalChange: handleLocalContentChange,
    onRemoteChange: handleRemoteContentChange,
    onLeaderSync: handleLeaderSync,
  })

  if (isStartTab)
    return { kind: 'start' }

  if (!fileTabId)
    return { kind: 'empty' }

  if (nodeViewStatus === 'resolving')
    return { kind: 'resolving' }

  if (nodeViewStatus === 'missing')
    return { kind: 'missing' }

  if (isLoading)
    return { kind: 'loading' }

  if (error)
    return { kind: 'error' }

  const downloadUrl = downloadUrlData?.download_url || ''
  const fileName = currentFileNode?.name || ''
  const fileSize = currentFileNode?.size

  if (isMarkdown) {
    return {
      kind: 'editor',
      editor: 'markdown',
      fileTabId,
      fileName,
      content: currentContent,
      onChange: handleMarkdownCollaborativeChange,
      autoFocus: shouldAutoFocusEditor,
      onAutoFocus: handleEditorAutoFocus,
      collaborationEnabled: canInitCollaboration,
    }
  }

  if (isCodeOrText) {
    return {
      kind: 'editor',
      editor: 'code',
      fileTabId,
      fileName,
      content: currentContent,
      onChange: handleCodeCollaborativeChange,
      autoFocus: shouldAutoFocusEditor,
      onAutoFocus: handleEditorAutoFocus,
      collaborationEnabled: canInitCollaboration,
    }
  }

  if (isImage || isVideo) {
    return {
      kind: 'preview',
      preview: 'media',
      mediaType: isImage ? 'image' : 'video',
      downloadUrl,
    }
  }

  if (isSQLite) {
    return {
      kind: 'preview',
      preview: 'sqlite',
      fileTabId,
      downloadUrl,
    }
  }

  if (isPdf) {
    return {
      kind: 'preview',
      preview: 'pdf',
      downloadUrl,
    }
  }

  return {
    kind: 'preview',
    preview: 'unsupported',
    fileName,
    fileSize,
    downloadUrl,
  }
}
