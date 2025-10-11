import React, { type FC, useCallback, useEffect, useMemo, useRef } from 'react'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import classNames from '@/utils/classnames'
import { Editor } from '@monaco-editor/react'
import { RiClipboardLine, RiIndentIncrease } from '@remixicon/react'
import copy from 'copy-to-clipboard'
import Tooltip from '@/app/components/base/tooltip'
import { useTranslation } from 'react-i18next'

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
  const monacoRef = useRef<any>(null)
  const editorRef = useRef<any>(null)
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

  const handleEditorDidMount = useCallback((editor: any, monaco: any) => {
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
  }, [])

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
    <div className={classNames('flex h-full flex-col overflow-hidden bg-components-input-bg-normal', hideTopMenu && 'pt-2', className)}>
      {!hideTopMenu && (
        <div className='flex items-center justify-between pl-2 pr-1 pt-1'>
          <div className='system-xs-semibold-uppercase py-0.5 text-text-secondary'>
            <span className='px-1 py-0.5'>JSON</span>
          </div>
          <div className='flex items-center gap-x-0.5'>
            {showFormatButton && (
              <Tooltip popupContent={t('common.operation.format')}>
                <button
                  type='button'
                  className='flex h-6 w-6 items-center justify-center'
                  onClick={formatJsonContent}
                >
                  <RiIndentIncrease className='h-4 w-4 text-text-tertiary' />
                </button>
              </Tooltip>
            )}
            <Tooltip popupContent={t('common.operation.copy')}>
              <button
                type='button'
                className='flex h-6 w-6 items-center justify-center'
                onClick={() => copy(value)}>
                <RiClipboardLine className='h-4 w-4 text-text-tertiary' />
              </button>
            </Tooltip>
          </div>
        </div>
      )}
      {topContent}
      <div className={classNames('relative overflow-hidden', editorWrapperClassName)}>
        <Editor
          defaultLanguage='json'
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
