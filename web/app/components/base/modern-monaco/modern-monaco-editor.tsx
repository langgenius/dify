'use client'

import type { editor as MonacoEditor } from 'modern-monaco/editor-core'
import type { FC } from 'react'
import * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import { cn } from '@/utils/classnames'
import { DARK_THEME_ID, initMonaco, LIGHT_THEME_ID } from './init'

type ModernMonacoEditorProps = {
  value: string
  language: string
  readOnly?: boolean
  options?: MonacoEditor.IEditorOptions
  onChange?: (value: string) => void
  onFocus?: () => void
  onBlur?: () => void
  onReady?: (editor: MonacoEditor.IStandaloneCodeEditor, monaco: typeof import('modern-monaco/editor-core')) => void
  loading?: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

type MonacoModule = typeof import('modern-monaco/editor-core')
type EditorCallbacks = Pick<ModernMonacoEditorProps, 'onBlur' | 'onChange' | 'onFocus' | 'onReady'>
type EditorSetup = {
  editorOptions: MonacoEditor.IEditorOptions
  language: string
  resolvedTheme: string
}

const syncEditorValue = (
  editor: MonacoEditor.IStandaloneCodeEditor,
  monaco: MonacoModule,
  model: MonacoEditor.ITextModel,
  value: string,
  preventTriggerChangeEventRef: React.RefObject<boolean>,
) => {
  const currentValue = model.getValue()
  if (currentValue === value)
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
}

const bindEditorCallbacks = (
  editor: MonacoEditor.IStandaloneCodeEditor,
  monaco: MonacoModule,
  callbacksRef: React.RefObject<EditorCallbacks>,
  preventTriggerChangeEventRef: React.RefObject<boolean>,
) => {
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

  return () => {
    blurDisposable.dispose()
    focusDisposable.dispose()
    keydownDisposable.dispose()
    changeDisposable.dispose()
  }
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
  loading,
  className,
  style,
}) => {
  const { theme: appTheme } = useTheme()
  const resolvedTheme = appTheme === Theme.light ? LIGHT_THEME_ID : DARK_THEME_ID
  const [isEditorReady, setIsEditorReady] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const modelRef = useRef<MonacoEditor.ITextModel | null>(null)
  const monacoRef = useRef<MonacoModule | null>(null)
  const preventTriggerChangeEventRef = useRef(false)
  const valueRef = useRef(value)
  const callbacksRef = useRef<EditorCallbacks>({ onChange, onFocus, onBlur, onReady })

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
  const setupRef = useRef<EditorSetup>({
    editorOptions,
    language,
    resolvedTheme,
  })

  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    callbacksRef.current = { onChange, onFocus, onBlur, onReady }
  }, [onChange, onFocus, onBlur, onReady])

  useEffect(() => {
    setupRef.current = {
      editorOptions,
      language,
      resolvedTheme,
    }
  }, [editorOptions, language, resolvedTheme])

  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | undefined

    const setup = async () => {
      const monaco = await initMonaco()
      if (!monaco || disposed || !containerRef.current)
        return

      monacoRef.current = monaco

      const editor = monaco.editor.create(containerRef.current, setupRef.current.editorOptions)
      editorRef.current = editor

      const model = monaco.editor.createModel(valueRef.current, setupRef.current.language)
      modelRef.current = model

      editor.setModel(model)

      monaco.editor.setTheme(setupRef.current.resolvedTheme)

      const disposeCallbacks = bindEditorCallbacks(
        editor,
        monaco,
        callbacksRef,
        preventTriggerChangeEventRef,
      )
      const resizeObserver = new ResizeObserver(() => {
        editor.layout()
      })
      resizeObserver.observe(containerRef.current)
      callbacksRef.current.onReady?.(editor, monaco)
      setIsEditorReady(true)

      cleanup = () => {
        resizeObserver.disconnect()
        disposeCallbacks()
        editor.dispose()
        model.dispose()
        setIsEditorReady(false)
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

    syncEditorValue(editor, monaco, model, value, preventTriggerChangeEventRef)
  }, [value])

  return (
    <div
      className={cn('relative h-full w-full', className)}
      style={style}
    >
      <div
        ref={containerRef}
        className="h-full w-full"
      />
      {!isEditorReady && !!loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          {loading}
        </div>
      )}
    </div>
  )
}
