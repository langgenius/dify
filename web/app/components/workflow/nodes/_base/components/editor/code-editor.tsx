'use client'
import type { FC } from 'react'
import Editor from '@monaco-editor/react'
import React from 'react'
import Base from './base'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'

type Props = {
  value: string
  onChange: (value: string) => void
  title: JSX.Element
  language: CodeLanguage
  headerRight?: JSX.Element
}

const CodeEditor: FC<Props> = ({
  value,
  onChange,
  title,
  headerRight,
  language,
}) => {
  const [isFocus, setIsFocus] = React.useState(false)

  const handleEditorChange = (value: string | undefined) => {
    onChange(value || '')
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
          value={value}
          onChange={handleEditorChange}
          // https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor.IEditorOptions.html
          options={{
            quickSuggestions: false,
            minimap: { enabled: false },
            // lineNumbers: (num) => {
            //   return <div>{num}</div>
            // }
          }}
        />

      </Base>
    </div>
  )
}
export default React.memo(CodeEditor)
