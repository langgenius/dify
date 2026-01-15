'use client'

import type { OnMount } from '@monaco-editor/react'
import type { FC } from 'react'
import type { AppAssetTreeView } from '@/types/app-asset'
import { loader } from '@monaco-editor/react'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Loading from '@/app/components/base/loading'
import Toast from '@/app/components/base/toast'
import useTheme from '@/hooks/use-theme'
import { useGetAppAssetFileContent, useGetAppAssetTree, useUpdateAppAssetFileContent } from '@/service/use-app-asset'
import { Theme } from '@/types/app'
import { basePath } from '@/utils/var'
import CodeFileEditor from './editor/code-file-editor'
import MarkdownFileEditor from './editor/markdown-file-editor'
import MediaFilePreview from './editor/media-file-preview'
import OfficeFilePlaceholder from './editor/office-file-placeholder'
import UnsupportedFileDownload from './editor/unsupported-file-download'
import { useSkillEditorStore, useSkillEditorStoreApi } from './store'
import { getFileExtension, getFileLanguage, isCodeOrTextFile, isImageFile, isMarkdownFile, isOfficeFile, isVideoFile } from './utils/file-utils'
import { buildNodeMap } from './utils/tree-utils'

if (typeof window !== 'undefined')
  loader.config({ paths: { vs: `${window.location.origin}${basePath}/vs` } })

const SkillDocEditor: FC = () => {
  const { t } = useTranslation('workflow')
  const { theme: appTheme } = useTheme()
  const [isMounted, setIsMounted] = useState(false)
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)

  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''

  const activeTabId = useSkillEditorStore(s => s.activeTabId)
  const dirtyContents = useSkillEditorStore(s => s.dirtyContents)
  const storeApi = useSkillEditorStoreApi()

  const { data: treeData } = useGetAppAssetTree(appId)

  const nodeMap = useMemo(() => {
    if (!treeData?.children)
      return new Map<string, AppAssetTreeView>()
    return buildNodeMap(treeData.children)
  }, [treeData?.children])

  const currentFileNode = activeTabId ? nodeMap.get(activeTabId) : undefined
  const fileExtension = getFileExtension(currentFileNode?.name, currentFileNode?.extension)
  const isMarkdown = isMarkdownFile(fileExtension)
  const isCodeOrText = isCodeOrTextFile(fileExtension)
  const isImage = isImageFile(fileExtension)
  const isVideo = isVideoFile(fileExtension)
  const isOffice = isOfficeFile(fileExtension)
  const isEditable = isMarkdown || isCodeOrText

  const {
    data: fileContent,
    isLoading,
    error,
  } = useGetAppAssetFileContent(appId, activeTabId || '')

  const updateContent = useUpdateAppAssetFileContent()

  const currentContent = useMemo(() => {
    if (!activeTabId)
      return ''
    const draft = dirtyContents.get(activeTabId)
    if (draft !== undefined)
      return draft
    return fileContent?.content ?? ''
  }, [activeTabId, dirtyContents, fileContent?.content])

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (!activeTabId || !isEditable)
      return
    storeApi.getState().setDraftContent(activeTabId, value ?? '')
  }, [activeTabId, isEditable, storeApi])

  const handleSave = useCallback(async () => {
    if (!activeTabId || !appId || !isEditable)
      return

    const content = dirtyContents.get(activeTabId)
    if (content === undefined)
      return

    try {
      await updateContent.mutateAsync({
        appId,
        nodeId: activeTabId,
        payload: { content },
      })
      storeApi.getState().clearDraftContent(activeTabId)
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
  }, [activeTabId, appId, dirtyContents, isEditable, storeApi, t, updateContent])

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

  const previewUrl = fileContent?.content || ''
  const fileName = currentFileNode?.name || ''
  const fileSize = currentFileNode?.size

  return (
    <div className="h-full w-full overflow-auto bg-components-panel-bg">
      {isMarkdown && (
        <MarkdownFileEditor
          value={currentContent}
          onChange={handleEditorChange}
        />
      )}
      {isCodeOrText && (
        <CodeFileEditor
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
          src={previewUrl}
        />
      )}
      {isOffice && (
        <OfficeFilePlaceholder />
      )}
      {!isMarkdown && !isCodeOrText && !isImage && !isVideo && !isOffice && (
        <UnsupportedFileDownload
          name={fileName}
          size={fileSize}
          downloadUrl={previewUrl}
        />
      )}
    </div>
  )
}

export default React.memo(SkillDocEditor)
