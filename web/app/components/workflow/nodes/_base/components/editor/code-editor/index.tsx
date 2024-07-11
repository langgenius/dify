'use client'
import type { FC } from 'react'
import Editor, { loader } from '@monaco-editor/react'
import React, { useEffect, useRef, useState } from 'react'
import Base from '../base'
import cn from '@/utils/classnames'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'

import './style.css'

// load file from local instead of cdn https://github.com/suren-atoyan/monaco-react/issues/482
loader.config({ paths: { vs: '/vs' } })

const CODE_EDITOR_LINE_HEIGHT = 18

export type Props = {
  value?: string | object
  placeholder?: string
  onChange?: (value: string) => void
  title?: JSX.Element
  language: CodeLanguage
  headerRight?: JSX.Element
  readOnly?: boolean
  isJSONStringifyBeauty?: boolean
  height?: number
  isInNode?: boolean
  onMount?: (editor: any, monaco: any) => void
  noWrapper?: boolean
  isExpand?: boolean
}

const languageMap = {
  [CodeLanguage.javascript]: 'javascript',
  [CodeLanguage.python3]: 'python',
  [CodeLanguage.json]: 'json',
}

const DEFAULT_THEME = {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#F2F4F7', // #00000000 transparent. But it will has a blue border
  },
}

const CodeEditor: FC<Props> = ({
  value = '',
  placeholder = '',
  onChange = () => { },
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
}) => {
  const [isFocus, setIsFocus] = React.useState(false)
  const [isMounted, setIsMounted] = React.useState(false)
  const minHeight = height || 200
  const [editorContentHeight, setEditorContentHeight] = useState(56)

  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
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

    editor.onDidFocusEditorText(() => {
      setIsFocus(true)
    })
    editor.onDidBlurEditorText(() => {
      setIsFocus(false)
    })

    monaco.editor.defineTheme('default-theme', DEFAULT_THEME)

    monaco.editor.defineTheme('blur-theme', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#F2F4F7',
      },
    })

    monaco.editor.defineTheme('focus-theme', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#ffffff',
      },
    })

    monaco.editor.setTheme('default-theme') // Fix: sometimes not load the default theme

    onMount?.(editor, monaco)
    setIsMounted(true)
  }

  const outPutValue = (() => {
    if (!isJSONStringifyBeauty)
      return value as string
    try {
      return JSON.stringify(value as object, null, 2)
    }
    catch (e) {
      return value as string
    }
  })()

  const theme = (() => {
    if (noWrapper)
      return 'default-theme'

    return isFocus ? 'focus-theme' : 'blur-theme'
  })()

  const main = (
    <>
      {/* https://www.npmjs.com/package/@monaco-editor/react */}
      <Editor
        // className='min-h-[100%]' // h-full
        // language={language === CodeLanguage.javascript ? 'javascript' : 'python'}
        language={languageMap[language] || 'javascript'}
        theme={isMounted ? theme : 'default-theme'} // sometimes not load the default theme
        value={outPutValue}
        onChange={handleEditorChange}
        // https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor.IEditorOptions.html
        options={{
          readOnly,
          domReadOnly: true,
          quickSuggestions: false,
          minimap: { enabled: false },
          lineNumbersMinChars: 1, // would change line num width
          wordWrap: 'on', // auto line wrap
          // lineNumbers: (num) => {
          //   return <div>{num}</div>
          // }
          // hide ambiguousCharacters warning
          unicodeHighlight: {
            ambiguousCharacters: false,
          },
        }}
        onMount={handleEditorDidMount}
      />
      {!outPutValue && <div className='pointer-events-none absolute left-[36px] top-0 leading-[18px] text-[13px] font-normal text-gray-300'>{placeholder}</div>}
    </>
  )

  return (
    <div className={cn(isExpand && 'h-full')}>
      {noWrapper
        ? <div className='relative no-wrapper' style={{
          height: isExpand ? '100%' : (editorContentHeight) / 2 + CODE_EDITOR_LINE_HEIGHT, // In IDE, the last line can always be in lop line. So there is some blank space in the bottom.
          minHeight: CODE_EDITOR_LINE_HEIGHT,
        }}>
          {main}
        </div>
        : (
          <Base
            className='relative'
            title={title}
            value={outPutValue}
            headerRight={headerRight}
            isFocus={isFocus && !readOnly}
            minHeight={minHeight}
            isInNode={isInNode}
          >
            {main}
          </Base>
        )}
    </div>
  )
}
export default React.memo(CodeEditor)
