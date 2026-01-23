'use client'

import type { OnMount } from '@monaco-editor/react'
import type { FC } from 'react'
import { loader } from '@monaco-editor/react'
import dynamic from 'next/dynamic'
import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Loading from '@/app/components/base/loading'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import { basePath } from '@/utils/var'
import { START_TAB_ID } from './constants'
import CodeFileEditor from './editor/code-file-editor'
import MarkdownFileEditor from './editor/markdown-file-editor'
import { useFileTypeInfo } from './hooks/use-file-type-info'
import { useSkillAssetNodeMap } from './hooks/use-skill-asset-tree'
import { useSkillFileData } from './hooks/use-skill-file-data'
import { useSkillFileSave } from './hooks/use-skill-file-save'
import StartTabContent from './start-tab-content'
import { getFileLanguage } from './utils/file-utils'
import MediaFilePreview from './viewer/media-file-preview'
import UnsupportedFileDownload from './viewer/unsupported-file-download'

const SQLiteFilePreview = dynamic(
  () => import('./viewer/sqlite-file-preview'),
  { ssr: false, loading: () => <Loading type="area" /> },
)

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
  const storeApi = useWorkflowStore()
  const { data: nodeMap } = useSkillAssetNodeMap()

  const isStartTab = activeTabId === START_TAB_ID
  const fileTabId = isStartTab ? null : activeTabId

  const draftContent = useStore(s => fileTabId ? s.dirtyContents.get(fileTabId) : undefined)
  const currentMetadata = useStore(s => fileTabId ? s.fileMetadata.get(fileTabId) : undefined)
  const isMetadataDirty = useStore(s => fileTabId ? s.dirtyMetadataIds.has(fileTabId) : false)

  const currentFileNode = fileTabId ? nodeMap?.get(fileTabId) : undefined

  const { isMarkdown, isCodeOrText, isImage, isVideo, isSQLite, isEditable } = useFileTypeInfo(currentFileNode)

  const { fileContent, downloadUrlData, isLoading, error } = useSkillFileData(appId, fileTabId, isEditable)

  const originalContent = fileContent?.content ?? ''
  const currentContent = draftContent !== undefined ? draftContent : originalContent

  useEffect(() => {
    if (!fileTabId || !fileContent)
      return
    if (isMetadataDirty)
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
    storeApi.getState().setFileMetadata(fileTabId, nextMetadata)
    storeApi.getState().clearDraftMetadata(fileTabId)
  }, [fileTabId, isMetadataDirty, fileContent, storeApi])

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (!fileTabId || !isEditable)
      return
    const newValue = value ?? ''

    if (newValue === originalContent)
      storeApi.getState().clearDraftContent(fileTabId)
    else
      storeApi.getState().setDraftContent(fileTabId, newValue)

    storeApi.getState().pinTab(fileTabId)
  }, [fileTabId, isEditable, originalContent, storeApi])

  useSkillFileSave({
    appId,
    activeTabId: fileTabId,
    isEditable,
    draftContent,
    isMetadataDirty,
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

  if (isStartTab)
    return <StartTabContent />

  if (!fileTabId) {
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

  // For non-editable files (media, sqlite, unsupported), use download URL
  const downloadUrl = downloadUrlData?.download_url || ''
  const fileName = currentFileNode?.name || ''
  const fileSize = currentFileNode?.size
  const isUnsupportedFile = !isMarkdown && !isCodeOrText && !isImage && !isVideo && !isSQLite

  return (
    <div className="h-full w-full overflow-auto bg-components-panel-bg">
      {isMarkdown
        ? (
            <MarkdownFileEditor
              key={fileTabId}
              value={currentContent}
              onChange={handleEditorChange}
            />
          )
        : null}
      {isCodeOrText
        ? (
            <CodeFileEditor
              key={fileTabId}
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
      {isSQLite
        ? (
            <SQLiteFilePreview
              key={fileTabId}
              downloadUrl={downloadUrl}
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
