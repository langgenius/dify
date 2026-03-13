'use client'
import type { FC } from 'react'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getFilesInLogs,
} from '@/app/components/base/file-uploader/utils'
import { ModernMonacoEditor } from '@/app/components/base/modern-monaco/modern-monaco-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { cn } from '@/utils/classnames'
import Base from '../base'
import './style.css'

const CODE_EDITOR_LINE_HEIGHT = 18

export type Props = {
  nodeId?: string
  value?: string | object
  placeholder?: React.JSX.Element | string
  onChange?: (value: string) => void
  title?: string | React.JSX.Element
  language: CodeLanguage
  headerRight?: React.JSX.Element
  readOnly?: boolean
  isJSONStringifyBeauty?: boolean
  height?: number
  isInNode?: boolean
  onMount?: (editor: any, monaco: any) => void
  noWrapper?: boolean
  isExpand?: boolean
  showFileList?: boolean
  onGenerated?: (value: string) => void
  showCodeGenerator?: boolean
  className?: string
  tip?: React.JSX.Element
  footer?: React.ReactNode
}

export const languageMap = {
  [CodeLanguage.javascript]: 'javascript',
  [CodeLanguage.python3]: 'python',
  [CodeLanguage.json]: 'json',
}

const CodeEditor: FC<Props> = ({
  nodeId,
  value = '',
  placeholder = '',
  onChange = noop,
  title = '',
  headerRight,
  language,
  readOnly,
  isJSONStringifyBeauty,
  height,
  isInNode,
  onMount,
  noWrapper,
  isExpand,
  showFileList,
  onGenerated,
  showCodeGenerator = false,
  className,
  tip,
  footer,
}) => {
  const { t } = useTranslation()
  const [isFocus, setIsFocus] = React.useState(false)
  const minHeight = height || 200
  const [editorContentHeight, setEditorContentHeight] = useState(56)

  const fileList = useMemo(() => {
    if (typeof value === 'object')
      return getFilesInLogs(value)
    return []
  }, [value])

  const editorRef = useRef<any>(null)
  const resizeEditorToContent = () => {
    if (editorRef.current) {
      const contentHeight = editorRef.current.getContentHeight() // Math.max(, minHeight)
      setEditorContentHeight(contentHeight)
    }
  }

  const handleEditorChange = (value: string | undefined) => {
    onChange(value || '')
    setTimeout(() => {
      resizeEditorToContent()
    }, 10)
  }

  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor
    resizeEditorToContent()
    onMount?.(editor, monaco)
  }

  const handleEditorFocus = () => {
    setIsFocus(true)
  }

  const handleEditorBlur = () => {
    setIsFocus(false)
  }

  const outPutValue = (() => {
    if (!isJSONStringifyBeauty)
      return value as string
    try {
      return JSON.stringify(value as object, null, 2)
    }
    catch {
      return value as string
    }
  })()

  const main = (
    <>
      <ModernMonacoEditor
        // className='min-h-[100%]' // h-full
        // language={language === CodeLanguage.javascript ? 'javascript' : 'python'}
        language={languageMap[language] || 'javascript'}
        value={outPutValue}
        readOnly={readOnly}
        onChange={handleEditorChange}
        onFocus={handleEditorFocus}
        onBlur={handleEditorBlur}
        onReady={handleEditorDidMount}
        loading={<span className="text-text-primary">{t('loading', { ns: 'common' })}</span>}
        // https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor.IEditorOptions.html
        options={{
          quickSuggestions: false,
          lineNumbersMinChars: 1, // would change line num width
          // lineNumbers: (num) => {
          //   return <div>{num}</div>
          // }
          // hide ambiguousCharacters warning
          unicodeHighlight: {
            ambiguousCharacters: false,
          },
          stickyScroll: { enabled: false },
        }}
      />
      {!outPutValue && !isFocus && <div className="pointer-events-none absolute left-[36px] top-0 text-[13px] font-normal leading-[18px] text-components-input-text-placeholder">{placeholder}</div>}
    </>
  )

  return (
    <div className={cn(isExpand && 'h-full', className)}>
      {noWrapper
        ? (
            <div
              className="no-wrapper relative"
              style={{
                height: isExpand ? '100%' : (editorContentHeight) / 2 + CODE_EDITOR_LINE_HEIGHT, // In IDE, the last line can always be in lop line. So there is some blank space in the bottom.
                minHeight: CODE_EDITOR_LINE_HEIGHT,
              }}
            >
              {main}
            </div>
          )
        : (
            <Base
              nodeId={nodeId}
              className="relative"
              title={title}
              value={outPutValue}
              headerRight={headerRight}
              isFocus={isFocus && !readOnly}
              minHeight={minHeight}
              isInNode={isInNode}
              onGenerated={onGenerated}
              codeLanguages={language}
              fileList={fileList as any}
              showFileList={showFileList}
              showCodeGenerator={showCodeGenerator}
              tip={tip}
              footer={footer}
            >
              {main}
            </Base>
          )}
    </div>
  )
}
export default React.memo(CodeEditor)
