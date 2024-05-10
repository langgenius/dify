'use client'
import type { FC } from 'react'
import Editor, { loader } from '@monaco-editor/react'

import React, { useRef } from 'react'
import Base from '../base'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import './style.css'

// load file from local instead of cdn https://github.com/suren-atoyan/monaco-react/issues/482
loader.config({ paths: { vs: '/vs' } })

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
}) => {
  const [isFocus, setIsFocus] = React.useState(false)
  const [isMounted, setIsMounted] = React.useState(false)
  const minHeight = height || 200

  const editorRef = useRef<any>(null)
  const resizeEditorToContent = () => {
    if (editorRef.current) {
      const contentHeight = Math.max(editorRef.current.getContentHeight(), minHeight)
      editorRef.current.layout({ height: contentHeight - 648 })
      setTimeout(() => {
        console.log(editorRef.current.getContentHeight() - contentHeight)
      }, 2000)
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
        }}
        onMount={handleEditorDidMount}
      />
      {!outPutValue && <div className='pointer-events-none absolute left-[36px] top-0 leading-[18px] text-[13px] font-normal text-gray-300'>{placeholder}</div>}
    </>
  )

  return (
    <div>
      {noWrapper
        ? <div className='relative no-wrapper' style={{
          // minHeight,
          // height: minHeight,
        }}>{main}</div>
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
