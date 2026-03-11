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
  const preventTriggerChangeEventRef = useRef(false)
  const valueRef = useRef(value)
  const callbacksRef = useRef({ onChange, onFocus, onBlur, onReady })

  const editorOptions = useMemo<MonacoEditor.IEditorOptions>(() => ({
    automaticLayout: true,
    readOnly,
    domReadOnly: true,
    minimap: { enabled: false },
    wordWrap: 'on',
    fixedOverflowWidgets: true,
    tabFocusMode: false,
    ...options,
  }), [readOnly, options])
  const setupRef = useRef({
    editorOptions,
    initOptions,
    language,
    resolvedTheme,
  })
  valueRef.current = value
  callbacksRef.current = { onChange, onFocus, onBlur, onReady }
  setupRef.current = {
    editorOptions,
    initOptions,
    language,
    resolvedTheme,
  }

  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | undefined

    const setup = async () => {
      const monaco = await initMonaco(setupRef.current.initOptions)
      if (!monaco || disposed || !containerRef.current)
        return

      const {
        editorOptions: currentEditorOptions,
        language: currentLanguage,
        resolvedTheme: currentResolvedTheme,
      } = setupRef.current

      monacoRef.current = monaco

      const model = monaco.editor.createModel(valueRef.current, currentLanguage)
      modelRef.current = model

      const editor = monaco.editor.create(containerRef.current, currentEditorOptions)
      editorRef.current = editor
      editor.setModel(model)

      monaco.editor.setTheme(currentResolvedTheme)

      const changeDisposable = editor.onDidChangeModelContent(() => {
        if (preventTriggerChangeEventRef.current)
          return
        callbacksRef.current.onChange?.(editor.getValue())
      })
      const keydownDisposable = editor.onKeyDown((event) => {
        const { key, code } = event.browserEvent
        if (key === ' ' || code === 'Space')
          event.stopPropagation()
      })

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
      callbacksRef.current.onReady?.(editor, monaco)

      cleanup = () => {
        resizeObserver.disconnect()
        blurDisposable.dispose()
        focusDisposable.dispose()
        keydownDisposable.dispose()
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
    const editor = editorRef.current
    const monaco = monacoRef.current
    const model = modelRef.current
    if (!editor || !monaco || !model)
      return

    const current = model.getValue()
    if (current === value)
      return

    if (editor.getOption(monaco.editor.EditorOption.readOnly)) {
      editor.setValue(value)
      return
    }

    preventTriggerChangeEventRef.current = true
    try {
      editor.executeEdits('', [{
        range: model.getFullModelRange(),
        text: value,
        forceMoveMarkers: true,
      }])
      editor.pushUndoStop()
    }
    finally {
      preventTriggerChangeEventRef.current = false
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
