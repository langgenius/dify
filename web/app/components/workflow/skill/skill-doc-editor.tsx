'use client'

import type { OnMount } from '@monaco-editor/react'
import type { FC } from 'react'
import { loader } from '@monaco-editor/react'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Loading from '@/app/components/base/loading'
import Toast from '@/app/components/base/toast'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import useTheme from '@/hooks/use-theme'
import { useGetAppAssetFileContent, useGetAppAssetFileDownloadUrl, useUpdateAppAssetFileContent } from '@/service/use-app-asset'
import { Theme } from '@/types/app'
import { basePath } from '@/utils/var'
import CodeFileEditor from './editor/code-file-editor'
import MarkdownFileEditor from './editor/markdown-file-editor'
import MediaFilePreview from './editor/media-file-preview'
import OfficeFilePlaceholder from './editor/office-file-placeholder'
import UnsupportedFileDownload from './editor/unsupported-file-download'
import { useSkillAssetNodeMap } from './hooks/use-skill-asset-tree'
import { getFileExtension, getFileLanguage, isCodeOrTextFile, isImageFile, isMarkdownFile, isOfficeFile, isVideoFile } from './utils/file-utils'

if (typeof window !== 'undefined')
  loader.config({ paths: { vs: `${window.location.origin}${basePath}/vs` } })

const SkillDocEditor: FC = () => {
  const { t } = useTranslation('workflow')
  const { theme: appTheme } = useTheme()
  const [isMounted, setIsMounted] = useState(false)
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)

  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''

  const activeTabId = useStore(s => s.activeTabId)
  const dirtyContents = useStore(s => s.dirtyContents)
  const dirtyMetadataIds = useStore(s => s.dirtyMetadataIds)
  const fileMetadata = useStore(s => s.fileMetadata)
  const storeApi = useWorkflowStore()
  const { data: nodeMap } = useSkillAssetNodeMap()

  const currentFileNode = activeTabId ? nodeMap?.get(activeTabId) : undefined

  const { isMarkdown, isCodeOrText, isImage, isVideo, isOffice, isEditable } = useMemo(() => {
    const ext = getFileExtension(currentFileNode?.name, currentFileNode?.extension)
    const markdown = isMarkdownFile(ext)
    const codeOrText = isCodeOrTextFile(ext)
    return {
      isMarkdown: markdown,
      isCodeOrText: codeOrText,
      isImage: isImageFile(ext),
      isVideo: isVideoFile(ext),
      isOffice: isOfficeFile(ext),
      isEditable: markdown || codeOrText,
    }
  }, [currentFileNode?.name, currentFileNode?.extension])

  const isMediaFile = isImage || isVideo

  const {
    data: fileContent,
    isLoading: isContentLoading,
    error: contentError,
  } = useGetAppAssetFileContent(appId, activeTabId || '', {
    enabled: !isMediaFile,
  })

  const {
    data: downloadUrlData,
    isLoading: isDownloadUrlLoading,
    error: downloadUrlError,
  } = useGetAppAssetFileDownloadUrl(appId, activeTabId || '', {
    enabled: isMediaFile && !!activeTabId,
  })

  const isLoading = isMediaFile ? isDownloadUrlLoading : isContentLoading
  const error = isMediaFile ? downloadUrlError : contentError

  const updateContent = useUpdateAppAssetFileContent()

  const originalContent = fileContent?.content ?? ''

  const currentContent = useMemo(() => {
    if (!activeTabId)
      return ''
    const draft = dirtyContents.get(activeTabId)
    if (draft !== undefined)
      return draft
    return originalContent
  }, [activeTabId, dirtyContents, originalContent])

  const currentMetadata = useMemo(() => {
    if (!activeTabId)
      return undefined
    return fileMetadata.get(activeTabId)
  }, [activeTabId, fileMetadata])

  useEffect(() => {
    if (!activeTabId || !fileContent)
      return
    if (dirtyMetadataIds.has(activeTabId))
      return
    let nextMetadata: Record<string, unknown> = {}
    if (fileContent.metadata) {
      if (typeof fileContent.metadata === 'string') {
        try {
          nextMetadata = JSON.parse(fileContent.metadata)
        }
        catch {
          nextMetadata = {}
        }
      }
      else {
        nextMetadata = fileContent.metadata
      }
    }
    storeApi.getState().setFileMetadata(activeTabId, nextMetadata)
    storeApi.getState().clearDraftMetadata(activeTabId)
  }, [activeTabId, dirtyMetadataIds, fileContent, storeApi])

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (!activeTabId || !isEditable)
      return
    const newValue = value ?? ''

    if (newValue === originalContent)
      storeApi.getState().clearDraftContent(activeTabId)
    else
      storeApi.getState().setDraftContent(activeTabId, newValue)

    storeApi.getState().pinTab(activeTabId)
  }, [activeTabId, isEditable, originalContent, storeApi])

  const handleSave = useCallback(async () => {
    if (!activeTabId || !appId || !isEditable)
      return

    const content = dirtyContents.get(activeTabId)
    const hasDirtyMetadata = dirtyMetadataIds.has(activeTabId)
    if (content === undefined && !hasDirtyMetadata)
      return

    try {
      await updateContent.mutateAsync({
        appId,
        nodeId: activeTabId,
        payload: {
          content: content ?? originalContent,
          ...(currentMetadata ? { metadata: currentMetadata } : {}),
        },
      })
      storeApi.getState().clearDraftContent(activeTabId)
      storeApi.getState().clearDraftMetadata(activeTabId)
      Toast.notify({
        type: 'success',
        message: t('api.saved', { ns: 'common' }),
      })
    }
    catch (error) {
      Toast.notify({
        type: 'error',
        message: String(error),
      })
    }
  }, [activeTabId, appId, currentMetadata, dirtyContents, dirtyMetadataIds, isEditable, originalContent, storeApi, t, updateContent])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave])

  const handleEditorDidMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor
    monaco.editor.setTheme(appTheme === Theme.light ? 'light' : 'vs-dark')
    setIsMounted(true)
  }, [appTheme])

  const language = currentFileNode ? getFileLanguage(currentFileNode.name) : 'plaintext'
  const theme = appTheme === Theme.light ? 'light' : 'vs-dark'

  if (!activeTabId) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-components-panel-bg text-text-tertiary">
        <span className="system-sm-regular">
          {t('skillSidebar.empty')}
        </span>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-components-panel-bg">
        <Loading type="area" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-components-panel-bg text-text-tertiary">
        <span className="system-sm-regular">
          {t('skillSidebar.loadError')}
        </span>
      </div>
    )
  }

  const mediaPreviewUrl = downloadUrlData?.download_url || ''
  const textPreviewUrl = fileContent?.content || ''
  const fileName = currentFileNode?.name || ''
  const fileSize = currentFileNode?.size

  return (
    <div className="h-full w-full overflow-auto bg-components-panel-bg">
      {isMarkdown && (
        <MarkdownFileEditor
          key={activeTabId}
          value={currentContent}
          onChange={handleEditorChange}
        />
      )}
      {isCodeOrText && (
        <CodeFileEditor
          key={activeTabId}
          language={language}
          theme={isMounted ? theme : 'default-theme'}
          value={currentContent}
          onChange={handleEditorChange}
          onMount={handleEditorDidMount}
        />
      )}
      {(isImage || isVideo) && (
        <MediaFilePreview
          type={isImage ? 'image' : 'video'}
          src={mediaPreviewUrl}
        />
      )}
      {isOffice && (
        <OfficeFilePlaceholder />
      )}
      {!isMarkdown && !isCodeOrText && !isImage && !isVideo && !isOffice && (
        <UnsupportedFileDownload
          name={fileName}
          size={fileSize}
          downloadUrl={textPreviewUrl}
        />
      )}
    </div>
  )
}

export default React.memo(SkillDocEditor)
