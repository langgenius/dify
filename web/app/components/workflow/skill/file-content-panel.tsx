'use client'

import type { OnMount } from '@monaco-editor/react'
import type { FC } from 'react'
import { loader } from '@monaco-editor/react'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Loading from '@/app/components/base/loading'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import { basePath } from '@/utils/var'
import CodeFileEditor from './editor/code-file-editor'
import MarkdownFileEditor from './editor/markdown-file-editor'
import { useFileTypeInfo } from './hooks/use-file-type-info'
import { useSkillAssetNodeMap } from './hooks/use-skill-asset-tree'
import { useSkillFileData } from './hooks/use-skill-file-data'
import { useSkillFileSave } from './hooks/use-skill-file-save'
import { getFileLanguage } from './utils/file-utils'
import MediaFilePreview from './viewer/media-file-preview'
import UnsupportedFileDownload from './viewer/unsupported-file-download'

if (typeof window !== 'undefined')
  loader.config({ paths: { vs: `${window.location.origin}${basePath}/vs` } })

const FileContentPanel: FC = () => {
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

  const { isMarkdown, isCodeOrText, isImage, isVideo, isEditable } = useFileTypeInfo(currentFileNode)

  const { fileContent, downloadUrlData, isLoading, error } = useSkillFileData(appId, activeTabId, isEditable)

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

  useSkillFileSave({
    appId,
    activeTabId,
    isEditable,
    dirtyContents,
    dirtyMetadataIds,
    originalContent,
    currentMetadata,
    storeApi,
    t,
  })

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

  // For non-editable files (media, unsupported), use download URL
  const downloadUrl = downloadUrlData?.download_url || ''
  const fileName = currentFileNode?.name || ''
  const fileSize = currentFileNode?.size
  const isUnsupportedFile = !isMarkdown && !isCodeOrText && !isImage && !isVideo

  return (
    <div className="h-full w-full overflow-auto bg-components-panel-bg">
      {isMarkdown
        ? (
            <MarkdownFileEditor
              key={activeTabId}
              value={currentContent}
              onChange={handleEditorChange}
            />
          )
        : null}
      {isCodeOrText
        ? (
            <CodeFileEditor
              key={activeTabId}
              language={language}
              theme={isMounted ? theme : 'default-theme'}
              value={currentContent}
              onChange={handleEditorChange}
              onMount={handleEditorDidMount}
            />
          )
        : null}
      {isImage || isVideo
        ? (
            <MediaFilePreview
              type={isImage ? 'image' : 'video'}
              src={downloadUrl}
            />
          )
        : null}
      {isUnsupportedFile
        ? (
            <UnsupportedFileDownload
              name={fileName}
              size={fileSize}
              downloadUrl={downloadUrl}
            />
          )
        : null}
    </div>
  )
}

export default React.memo(FileContentPanel)
