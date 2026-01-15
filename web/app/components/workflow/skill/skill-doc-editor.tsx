'use client'

import type { FC } from 'react'
import type { AppAssetTreeView } from './type'
import Editor, { loader } from '@monaco-editor/react'
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
import { useSkillEditorStore, useSkillEditorStoreApi } from './store'
import { buildNodeMap } from './type'
import { getFileLanguage } from './utils'

// load file from local instead of cdn
if (typeof window !== 'undefined')
  loader.config({ paths: { vs: `${window.location.origin}${basePath}/vs` } })

/**
 * SkillDocEditor - Document editor for skill files
 *
 * Features:
 * - Monaco editor for code/text editing
 * - Auto-load content when tab is activated
 * - Dirty state tracking via store
 * - Save with Ctrl+S / Cmd+S
 *
 * Design notes from MVP:
 * - `dirtyContents` only stores modified content, not full cache
 * - `dirty = dirtyContents.has(fileId)`, no diff with server content
 * - closeTab doesn't show dirty confirmation dialog (MVP)
 */
const SkillDocEditor: FC = () => {
  const { t } = useTranslation('workflow')
  const { theme: appTheme } = useTheme()
  const [isMounted, setIsMounted] = useState(false)
  const editorRef = useRef<any>(null)

  // Get appId from app store
  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''

  // Store state
  const activeTabId = useSkillEditorStore(s => s.activeTabId)
  const dirtyContents = useSkillEditorStore(s => s.dirtyContents)
  const storeApi = useSkillEditorStoreApi()

  // Fetch tree data for file name lookup
  const { data: treeData } = useGetAppAssetTree(appId)

  // Build node map for quick lookup
  const nodeMap = useMemo(() => {
    if (!treeData?.children)
      return new Map<string, AppAssetTreeView>()
    return buildNodeMap(treeData.children)
  }, [treeData?.children])

  // Get current file node
  const currentFileNode = activeTabId ? nodeMap.get(activeTabId) : undefined

  // Fetch file content from API
  const {
    data: fileContent,
    isLoading,
    error,
  } = useGetAppAssetFileContent(appId, activeTabId || '')

  // Save mutation
  const updateContent = useUpdateAppAssetFileContent()

  // Get draft content or server content
  const currentContent = useMemo(() => {
    if (!activeTabId)
      return ''
    // Check if there's a draft first
    const draft = dirtyContents.get(activeTabId)
    if (draft !== undefined)
      return draft
    // Otherwise use server content
    return fileContent?.content ?? ''
  }, [activeTabId, dirtyContents, fileContent?.content])

  // Handle editor content change
  const handleEditorChange = useCallback((value: string | undefined) => {
    if (!activeTabId)
      return
    // Set draft content in store
    storeApi.getState().setDraftContent(activeTabId, value ?? '')
  }, [activeTabId, storeApi])

  // Handle save
  const handleSave = useCallback(async () => {
    if (!activeTabId || !appId)
      return

    const content = dirtyContents.get(activeTabId)
    if (content === undefined)
      return // No changes to save

    try {
      await updateContent.mutateAsync({
        appId,
        nodeId: activeTabId,
        payload: { content },
      })
      // Clear draft on success
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
  }, [activeTabId, appId, dirtyContents, storeApi, t, updateContent])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S / Cmd+S to save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave])

  // Handle editor mount
  const handleEditorDidMount = useCallback((editor: any, monaco: any) => {
    editorRef.current = editor
    monaco.editor.setTheme(appTheme === Theme.light ? 'light' : 'vs-dark')
    setIsMounted(true)
  }, [appTheme])

  // Determine editor language from file extension
  const language = useMemo(() => {
    if (!activeTabId || !currentFileNode)
      return 'plaintext'
    // Get language from file name in tree data
    return getFileLanguage(currentFileNode.name)
  }, [activeTabId, currentFileNode])

  const theme = useMemo(() => {
    return appTheme === Theme.light ? 'light' : 'vs-dark'
  }, [appTheme])

  // No active tab
  if (!activeTabId) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-components-panel-bg text-text-tertiary">
        <span className="system-sm-regular">
          {t('skillSidebar.empty')}
        </span>
      </div>
    )
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-components-panel-bg">
        <Loading type="area" />
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-components-panel-bg text-text-tertiary">
        <span className="system-sm-regular">
          {t('skillSidebar.loadError')}
        </span>
      </div>
    )
  }

  return (
    <div className="h-full w-full overflow-hidden bg-components-panel-bg">
      <Editor
        language={language}
        theme={isMounted ? theme : 'default-theme'}
        value={currentContent}
        loading={<Loading type="area" />}
        onChange={handleEditorChange}
        options={{
          minimap: { enabled: false },
          lineNumbersMinChars: 3,
          wordWrap: 'on',
          unicodeHighlight: {
            ambiguousCharacters: false,
          },
          stickyScroll: { enabled: false },
          fontSize: 13,
          lineHeight: 20,
          padding: { top: 12, bottom: 12 },
        }}
        onMount={handleEditorDidMount}
      />
    </div>
  )
}

export default React.memo(SkillDocEditor)
