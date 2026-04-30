import type { ComponentProps, FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { Editor } from '@monaco-editor/react'
import copy from 'copy-to-clipboard'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'

type CodeEditorProps = {
  value: string
  onUpdate?: (value: string) => void
  showFormatButton?: boolean
  editorWrapperClassName?: string
  readOnly?: boolean
  hideTopMenu?: boolean
  onFocus?: () => void
  onBlur?: () => void
  topContent?: React.ReactNode
} & React.HTMLAttributes<HTMLDivElement>

type EditorOnMount = NonNullable<ComponentProps<typeof Editor>['onMount']>
type MonacoEditor = Parameters<EditorOnMount>[0]
type Monaco = Parameters<EditorOnMount>[1]

const CodeEditor: FC<CodeEditorProps> = ({
  value,
  onUpdate,
  showFormatButton = true,
  editorWrapperClassName,
  readOnly = false,
  hideTopMenu = false,
  topContent,
  className,
  onFocus,
  onBlur,
}) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const monacoRef = useRef<Monaco | null>(null)
  const editorRef = useRef<MonacoEditor | null>(null)
  const [isMounted, setIsMounted] = React.useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (monacoRef.current) {
      if (theme === Theme.light)
        monacoRef.current.editor.setTheme('light-theme')
      else
        monacoRef.current.editor.setTheme('dark-theme')
    }
  }, [theme])

  const handleEditorDidMount = useCallback<EditorOnMount>((editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco

    editor.onDidFocusEditorText(() => {
      onFocus?.()
    })
    editor.onDidBlurEditorText(() => {
      onBlur?.()
    })

    monaco.editor.defineTheme('light-theme', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#00000000',
        'editor.lineHighlightBackground': '#00000000',
        'focusBorder': '#00000000',
      },
    })
    monaco.editor.defineTheme('dark-theme', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#00000000',
        'editor.lineHighlightBackground': '#00000000',
        'focusBorder': '#00000000',
      },
    })
    monaco.editor.setTheme('light-theme')
    setIsMounted(true)
  }, [onBlur, onFocus])

  const formatJsonContent = useCallback(() => {
    if (editorRef.current)
      editorRef.current.getAction('editor.action.formatDocument')?.run()
  }, [])

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (value !== undefined)
      onUpdate?.(value)
  }, [onUpdate])

  const editorTheme = useMemo(() => {
    if (theme === Theme.light)
      return 'light-theme'
    return 'dark-theme'
  }, [theme])
  useEffect(() => {
    const resizeObserver = new ResizeObserver(() => {
      editorRef.current?.layout()
    })

    if (containerRef.current)
      resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  return (
    <div className={cn('flex h-full flex-col overflow-hidden bg-components-input-bg-normal', hideTopMenu && 'pt-2', className)}>
      {!hideTopMenu && (
        <div className="flex items-center justify-between pt-1 pr-1 pl-2">
          <div className="py-0.5 system-xs-semibold-uppercase text-text-secondary">
            <span className="px-1 py-0.5">JSON</span>
          </div>
          <div className="flex items-center gap-x-0.5">
            {showFormatButton && (
              <Tooltip>
                <TooltipTrigger
                  render={(
                    <button
                      type="button"
                      aria-label={t('operation.format', { ns: 'common' })}
                      className="flex h-6 w-6 items-center justify-center"
                      onClick={formatJsonContent}
                    >
                      <span aria-hidden className="i-ri-indent-increase h-4 w-4 text-text-tertiary" />
                    </button>
                  )}
                />
                <TooltipContent>{t('operation.format', { ns: 'common' })}</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger
                render={(
                  <button
                    type="button"
                    aria-label={t('operation.copy', { ns: 'common' })}
                    className="flex h-6 w-6 items-center justify-center"
                    onClick={() => copy(value)}
                  >
                    <span aria-hidden className="i-ri-clipboard-line h-4 w-4 text-text-tertiary" />
                  </button>
                )}
              />
              <TooltipContent>{t('operation.copy', { ns: 'common' })}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}
      {topContent}
      <div className={cn('relative overflow-hidden', editorWrapperClassName)}>
        <Editor
          defaultLanguage="json"
          theme={isMounted ? editorTheme : 'default-theme'} // sometimes not load the default theme
          value={value}
          onChange={handleEditorChange}
          onMount={handleEditorDidMount}
          options={{
            readOnly,
            domReadOnly: true,
            minimap: { enabled: false },
            tabSize: 2,
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            wrappingIndent: 'same',
            overviewRulerBorder: false,
            hideCursorInOverviewRuler: true,
            renderLineHighlightOnlyWhenFocus: false,
            renderLineHighlight: 'none',
            // Hide scrollbar borders
            scrollbar: {
              vertical: 'hidden',
              horizontal: 'hidden',
              verticalScrollbarSize: 0,
              horizontalScrollbarSize: 0,
              alwaysConsumeMouseWheel: false,
            },
          }}
        />
      </div>
    </div>
  )
}

export default React.memo(CodeEditor)
