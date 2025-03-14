import { Editor } from '@monaco-editor/react'
import { RiClipboardLine, RiIndentIncrease } from '@remixicon/react'
import copy from 'copy-to-clipboard'
import React, { type FC, useCallback, useRef } from 'react'

type SchemaEditorProps = {
  schema: string
  onUpdate: (schema: string) => void
}

const SchemaEditor: FC<SchemaEditorProps> = ({
  schema,
  onUpdate,
}) => {
  const monacoRef = useRef<any>(null)
  const editorRef = useRef<any>(null)

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
    monaco.editor.setTheme('light-theme')
  }, [])

  const formatJsonContent = useCallback(() => {
    if (editorRef.current)
      editorRef.current.getAction('editor.action.formatDocument')?.run()
  }, [])

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (!value)
      return
    onUpdate(value)
  }, [onUpdate])

  return (
    <div className='flex flex-col h-full rounded-xl bg-components-input-bg-normal overflow-hidden'>
      <div className='flex items-center justify-between pl-2 pt-1 pr-1'>
        <div className='py-0.5 text-text-secondary system-xs-semibold-uppercase'>
          <span className='px-1 py-0.5'>JSON</span>
        </div>
        <div className='flex items-center gap-x-0.5'>
          <button
            type='button'
            className='flex items-center justify-center h-6 w-6'
            onClick={formatJsonContent}
          >
            <RiIndentIncrease className='w-4 h-4 text-text-tertiary' />
          </button>
          <button
            type='button'
            className='flex items-center justify-center h-6 w-6'
            onClick={() => copy(schema)}>
            <RiClipboardLine className='w-4 h-4 text-text-tertiary' />
          </button>
        </div>
      </div>
      <div className='relative grow'>
        <Editor
          height='100%'
          defaultLanguage='json'
          value={schema}
          onChange={handleEditorChange}
          onMount={handleEditorDidMount}
          options={{
            readOnly: false,
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

export default SchemaEditor
