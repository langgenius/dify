'use client'
import type { FC } from 'react'
import Editor from '@monaco-editor/react'
import React, { useRef } from 'react'
import Base from '../base'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import './style.css'

type Props = {
  value: string
  onChange: (value: string) => void
  title: JSX.Element
  language: CodeLanguage
  headerRight?: JSX.Element
  readOnly?: boolean
}

const CodeEditor: FC<Props> = ({
  value,
  onChange,
  title,
  headerRight,
  language,
  readOnly,
}) => {
  const [isFocus, setIsFocus] = React.useState(false)

  const handleEditorChange = (value: string | undefined) => {
    onChange(value || '')
  }

  const editorRef = useRef(null)
  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor
    editor.onDidFocusEditorText(() => {
      setIsFocus(true)
    })
    editor.onDidBlurEditorText(() => {
      setIsFocus(false)
    })

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
  }

  return (
    <div>
      <Base
        title={title}
        value={value}
        headerRight={headerRight}
        isFocus={isFocus}
        minHeight={200}
      >
        {/* https://www.npmjs.com/package/@monaco-editor/react */}
        <Editor
          className='h-full'
          defaultLanguage={language === CodeLanguage.javascript ? 'javascript' : 'python'}
          theme={isFocus ? 'focus-theme' : 'blur-theme'}
          value={value}
          onChange={handleEditorChange}
          // https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor.IEditorOptions.html
          options={{
            readOnly,
            quickSuggestions: false,
            minimap: { enabled: false },
            lineNumbersMinChars: 1, // would change line num width
            // lineNumbers: (num) => {
            //   return <div>{num}</div>
            // }
          }}
          onMount={handleEditorDidMount}
        />
      </Base>
    </div>
  )
}
export default React.memo(CodeEditor)
