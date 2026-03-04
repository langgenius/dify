'use client'

import type { InitOptions } from 'modern-monaco'
import type { editor as MonacoEditor } from 'modern-monaco/editor-core'
import type { FC } from 'react'
import * as React from 'react'
import { useEffect, useMemo, useRef } from 'react'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import { cn } from '@/utils/classnames'

type ModernMonacoEditorProps = {
  value: string
  language: string
  readOnly?: boolean
  options?: MonacoEditor.IEditorOptions
  initOptions?: InitOptions
  onChange?: (value: string) => void
  onFocus?: () => void
  onBlur?: () => void
  onReady?: (editor: MonacoEditor.IStandaloneCodeEditor, monaco: typeof import('modern-monaco/editor-core')) => void
  className?: string
  style?: React.CSSProperties
}

let monacoInitPromise: Promise<typeof import('modern-monaco/editor-core') | null> | null = null
let monacoInitOptions: InitOptions | null = null

const LIGHT_THEME_ID = 'github-light-default'
const DARK_THEME_ID = 'github-dark-default'

const DEFAULT_INIT_OPTIONS: InitOptions = {
  defaultTheme: DARK_THEME_ID,
  themes: [
    LIGHT_THEME_ID,
    DARK_THEME_ID,
  ],
}

const initMonaco = async (initOptions?: InitOptions) => {
  const resolvedInitOptions = initOptions ?? DEFAULT_INIT_OPTIONS
  if (!monacoInitPromise) {
    monacoInitOptions = resolvedInitOptions
    monacoInitPromise = (async () => {
      const { init } = await import('modern-monaco')
      return init(resolvedInitOptions)
    })()
  }
  else if (initOptions && monacoInitOptions !== initOptions) {
    // Ignore subsequent init options once Monaco is initialized.
  }
  return monacoInitPromise
}

export const ModernMonacoEditor: FC<ModernMonacoEditorProps> = ({
  value,
  language,
  readOnly = false,
  options,
  onChange,
  onFocus,
  onBlur,
  onReady,
  initOptions,
  className,
  style,
}) => {
  const { theme: appTheme } = useTheme()
  const resolvedTheme = appTheme === Theme.light ? LIGHT_THEME_ID : DARK_THEME_ID
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const modelRef = useRef<MonacoEditor.ITextModel | null>(null)
  const monacoRef = useRef<typeof import('modern-monaco/editor-core') | null>(null)
  const skipNextChangeRef = useRef(false)
  const valueRef = useRef(value)
  const callbacksRef = useRef({ onChange, onFocus, onBlur, onReady })

  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    callbacksRef.current = { onChange, onFocus, onBlur, onReady }
  }, [onChange, onFocus, onBlur, onReady])

  const editorOptions = useMemo<MonacoEditor.IEditorOptions>(() => ({
    readOnly,
    domReadOnly: true,
    minimap: { enabled: false },
    wordWrap: 'on',
    fixedOverflowWidgets: true,
    ...options,
  }), [readOnly, options])

  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | undefined

    const setup = async () => {
      const monaco = await initMonaco(initOptions)
      if (!monaco || disposed || !containerRef.current)
        return

      monacoRef.current = monaco

      const model = monaco.editor.createModel(valueRef.current, language)
      modelRef.current = model

      const editor = monaco.editor.create(containerRef.current, editorOptions)
      editorRef.current = editor
      editor.setModel(model)

      callbacksRef.current.onReady?.(editor, monaco)
      monaco.editor.setTheme(resolvedTheme)

      const changeDisposable = editor.onDidChangeModelContent(() => {
        if (skipNextChangeRef.current) {
          skipNextChangeRef.current = false
          return
        }
        callbacksRef.current.onChange?.(editor.getValue())
      })
      const container = containerRef.current
      const handleKeydown = (event: KeyboardEvent) => {
        if (event.key === 'Tab')
          event.preventDefault()
        event.stopPropagation()
      }
      const handleKeyup = (event: KeyboardEvent) => {
        event.stopPropagation()
      }
      const keyListenerAbortController = new AbortController()
      container?.addEventListener('keydown', handleKeydown, { signal: keyListenerAbortController.signal })
      container?.addEventListener('keyup', handleKeyup, { signal: keyListenerAbortController.signal })

      const focusDisposable = editor.onDidFocusEditorText(() => {
        callbacksRef.current.onFocus?.()
      })
      const blurDisposable = editor.onDidBlurEditorText(() => {
        callbacksRef.current.onBlur?.()
      })

      const resizeObserver = new ResizeObserver(() => {
        editor.layout()
      })
      resizeObserver.observe(containerRef.current)

      cleanup = () => {
        resizeObserver.disconnect()
        blurDisposable.dispose()
        focusDisposable.dispose()
        keyListenerAbortController.abort()
        changeDisposable.dispose()
        editor.dispose()
        model.dispose()
      }
    }

    setup()

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor)
      return
    editor.updateOptions(editorOptions)
  }, [editorOptions])

  useEffect(() => {
    const monaco = monacoRef.current
    const model = modelRef.current
    if (!monaco || !model)
      return
    monaco.editor.setModelLanguage(model, language)
  }, [language])

  useEffect(() => {
    const monaco = monacoRef.current
    if (!monaco)
      return
    monaco.editor.setTheme(resolvedTheme)
  }, [resolvedTheme])

  useEffect(() => {
    const model = modelRef.current
    if (!model)
      return
    const current = model.getValue()
    if (current !== value) {
      skipNextChangeRef.current = true
      model.setValue(value)
    }
  }, [value])

  return (
    <div
      ref={containerRef}
      className={cn('h-full w-full', className)}
      style={style}
    />
  )
}
