import React, { type FC, useCallback, useEffect, useRef } from 'react'
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
} & React.HTMLAttributes<HTMLDivElement>

const CodeEditor: FC<CodeEditorProps> = ({
  value,
  onUpdate,
  showFormatButton = true,
  editorWrapperClassName,
  readOnly = false,
  className,
}) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const monacoRef = useRef<any>(null)
  const editorRef = useRef<any>(null)

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
  }, [])

  const formatJsonContent = useCallback(() => {
    if (editorRef.current)
      editorRef.current.getAction('editor.action.formatDocument')?.run()
  }, [])

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (value)
      onUpdate?.(value)
  }, [onUpdate])

  return (
    <div className={classNames('flex flex-col h-full bg-components-input-bg-normal overflow-hidden', className)}>
      <div className='flex items-center justify-between pl-2 pt-1 pr-1'>
        <div className='py-0.5 text-text-secondary system-xs-semibold-uppercase'>
          <span className='px-1 py-0.5'>JSON</span>
        </div>
        <div className='flex items-center gap-x-0.5'>
          {showFormatButton && (
            <Tooltip popupContent={t('common.operation.format')}>
              <button
                type='button'
                className='flex items-center justify-center h-6 w-6'
                onClick={formatJsonContent}
              >
                <RiIndentIncrease className='w-4 h-4 text-text-tertiary' />
              </button>
            </Tooltip>
          )}
          <Tooltip popupContent={t('common.operation.copy')}>
            <button
              type='button'
              className='flex items-center justify-center h-6 w-6'
              onClick={() => copy(value)}>
              <RiClipboardLine className='w-4 h-4 text-text-tertiary' />
            </button>
          </Tooltip>
        </div>
      </div>
      <div className={classNames('relative', editorWrapperClassName)}>
        <Editor
          height='100%'
          defaultLanguage='json'
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
            // Add these options
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
