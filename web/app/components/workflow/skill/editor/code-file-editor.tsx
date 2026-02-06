import type { OnMount } from '@monaco-editor/react'
import Editor from '@monaco-editor/react'
import * as React from 'react'
import Loading from '@/app/components/base/loading'
import { useSkillCodeCursors } from './code-editor/plugins/remote-cursors'

type CodeFileEditorProps = {
  language: string
  theme: string
  value: string
  onChange: (value: string | undefined) => void
  onMount: OnMount
  autoFocus?: boolean
  onAutoFocus?: () => void
  fileId?: string | null
  collaborationEnabled?: boolean
  readOnly?: boolean
}

const CodeFileEditor = ({
  language,
  theme,
  value,
  onChange,
  onMount,
  autoFocus = false,
  onAutoFocus,
  fileId,
  collaborationEnabled,
  readOnly,
}: CodeFileEditorProps) => {
  const [editorInstance, setEditorInstance] = React.useState<Parameters<typeof onMount>[0] | null>(null)
  const { overlay } = useSkillCodeCursors({
    editor: editorInstance,
    fileId: fileId ?? null,
    enabled: Boolean(collaborationEnabled && fileId && !readOnly),
  })
  const handleMount = React.useCallback<OnMount>((editor, monaco) => {
    setEditorInstance(editor)
    onMount(editor, monaco)
    if (autoFocus && !readOnly) {
      requestAnimationFrame(() => {
        editor.focus()
        onAutoFocus?.()
      })
    }
  }, [autoFocus, onAutoFocus, onMount, readOnly])

  return (
    <div className="relative h-full w-full">
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
          readOnly,
        }}
        onMount={handleMount}
      />
      {overlay
        ? (
            <div className="pointer-events-none absolute inset-0 z-[2]">
              {overlay}
            </div>
          )
        : null}
    </div>
  )
}

export default React.memo(CodeFileEditor)
