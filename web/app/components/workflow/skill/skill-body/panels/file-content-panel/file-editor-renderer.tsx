'use client'

import type { OnMount } from '@monaco-editor/react'
import type { FileEditorState } from './types'
import { loader } from '@monaco-editor/react'
import * as React from 'react'
import { useCallback, useState } from 'react'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import { basePath } from '@/utils/var'
import CodeFileEditor from '../../../editor/code-file-editor'
import MarkdownFileEditor from '../../../editor/markdown-file-editor'
import { getFileLanguage } from '../../../utils/file-utils'

if (typeof window !== 'undefined')
  loader.config({ paths: { vs: `${window.location.origin}${basePath}/vs` } })

type FileEditorRendererProps = {
  state: FileEditorState
}

const FileEditorRenderer = ({ state }: FileEditorRendererProps) => {
  const { theme: appTheme } = useTheme()
  const [isMonacoMounted, setIsMonacoMounted] = useState(false)

  const handleEditorDidMount: OnMount = useCallback((_editor, monaco) => {
    monaco.editor.setTheme(appTheme === Theme.light ? 'light' : 'vs-dark')
    setIsMonacoMounted(true)
  }, [appTheme])

  if (state.editor === 'markdown') {
    return (
      <MarkdownFileEditor
        key={state.fileTabId}
        instanceId={state.fileTabId}
        value={state.content}
        onChange={state.onChange}
        autoFocus={state.autoFocus}
        onAutoFocus={state.onAutoFocus}
        collaborationEnabled={state.collaborationEnabled}
      />
    )
  }

  return (
    <CodeFileEditor
      key={state.fileTabId}
      language={getFileLanguage(state.fileName)}
      theme={isMonacoMounted
        ? appTheme === Theme.light ? 'light' : 'vs-dark'
        : 'default-theme'}
      value={state.content}
      onChange={state.onChange}
      onMount={handleEditorDidMount}
      autoFocus={state.autoFocus}
      onAutoFocus={state.onAutoFocus}
      fileId={state.fileTabId}
      collaborationEnabled={state.collaborationEnabled}
    />
  )
}

export default React.memo(FileEditorRenderer)
