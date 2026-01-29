'use client'

import type { OnMount } from '@monaco-editor/react'
import { loader } from '@monaco-editor/react'
import * as React from 'react'
import { useCallback, useRef, useState } from 'react'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import { basePath } from '@/utils/var'
import CodeFileEditor from '../editor/code-file-editor'

if (typeof window !== 'undefined')
  loader.config({ paths: { vs: `${window.location.origin}${basePath}/vs` } })

type ReadOnlyCodePreviewProps = {
  value: string
  language: string
}

const ReadOnlyCodePreview = ({ value, language }: ReadOnlyCodePreviewProps) => {
  const { theme: appTheme } = useTheme()
  const [isMounted, setIsMounted] = useState(false)
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)

  const theme = appTheme === Theme.light ? 'light' : 'vs-dark'

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor
    monaco.editor.setTheme(appTheme === Theme.light ? 'light' : 'vs-dark')
    setIsMounted(true)
  }, [appTheme])

  const noop = useCallback(() => {}, [])

  return (
    <CodeFileEditor
      language={language}
      theme={isMounted ? theme : 'default-theme'}
      value={value}
      onChange={noop}
      onMount={handleMount}
      readOnly
    />
  )
}

export default React.memo(ReadOnlyCodePreview)
