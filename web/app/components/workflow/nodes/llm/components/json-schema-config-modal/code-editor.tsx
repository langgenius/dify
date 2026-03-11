import type { FC } from 'react'
import { RiClipboardLine, RiIndentIncrease } from '@remixicon/react'
import copy from 'copy-to-clipboard'
import * as React from 'react'
import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ModernMonacoEditor } from '@/app/components/base/modern-monaco/modern-monaco-editor'
import Tooltip from '@/app/components/base/tooltip'
import { cn } from '@/utils/classnames'

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
  const editorRef = useRef<any>(null)

  const handleEditorReady = useCallback((editor: any) => {
    editorRef.current = editor
    editor.getModel()?.updateOptions({ tabSize: 2 })
  }, [])

  const formatJsonContent = useCallback(() => {
    if (editorRef.current)
      editorRef.current.getAction('editor.action.formatDocument')?.run()
  }, [])

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (value !== undefined)
      onUpdate?.(value)
  }, [onUpdate])

  return (
    <div className={cn('flex h-full flex-col overflow-hidden bg-components-input-bg-normal', hideTopMenu && 'pt-2', className)}>
      {!hideTopMenu && (
        <div className="flex items-center justify-between pl-2 pr-1 pt-1">
          <div className="py-0.5 text-text-secondary system-xs-semibold-uppercase">
            <span className="px-1 py-0.5">JSON</span>
          </div>
          <div className="flex items-center gap-x-0.5">
            {showFormatButton && (
              <Tooltip popupContent={t('operation.format', { ns: 'common' })}>
                <button
                  type="button"
                  className="flex h-6 w-6 items-center justify-center"
                  onClick={formatJsonContent}
                >
                  <RiIndentIncrease className="h-4 w-4 text-text-tertiary" />
                </button>
              </Tooltip>
            )}
            <Tooltip popupContent={t('operation.copy', { ns: 'common' })}>
              <button
                type="button"
                className="flex h-6 w-6 items-center justify-center"
                onClick={() => copy(value)}
              >
                <RiClipboardLine className="h-4 w-4 text-text-tertiary" />
              </button>
            </Tooltip>
          </div>
        </div>
      )}
      {topContent}
      <div className={cn('relative overflow-hidden', editorWrapperClassName)}>
        <ModernMonacoEditor
          language="json"
          value={value}
          readOnly={readOnly}
          onChange={handleEditorChange}
          onReady={handleEditorReady}
          onFocus={onFocus}
          onBlur={onBlur}
          loading={<span className="text-text-primary">{t('loading', { ns: 'common' })}</span>}
          options={{
            scrollBeyondLastLine: false,
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
