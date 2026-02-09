import type { FC } from 'react'
import Editor from '@monaco-editor/react'
import * as React from 'react'
import Loading from '@/app/components/base/loading'

type CodeFileEditorProps = {
  language: string
  theme: string
  value: string
  onChange: (value: string | undefined) => void
  onMount: (editor: any, monaco: any) => void
}

const CodeFileEditor: FC<CodeFileEditorProps> = ({ language, theme, value, onChange, onMount }) => {
  return (
    <Editor
      language={language}
      theme={theme}
      value={value}
      loading={<Loading type="area" />}
      onChange={onChange}
      options={{
        minimap: { enabled: false },
        lineNumbersMinChars: 3,
        wordWrap: 'on',
        unicodeHighlight: {
          ambiguousCharacters: false,
        },
        stickyScroll: { enabled: false },
        fontSize: 13,
        lineHeight: 20,
        padding: { top: 12, bottom: 12 },
      }}
      onMount={onMount}
    />
  )
}

export default React.memo(CodeFileEditor)
