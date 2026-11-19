import type { ChangeEvent } from 'react'
import { useEffect, useRef } from 'react'

type EditorProps = {
  value?: string
  onChange?: (value: string | undefined) => void
  onMount?: (editor: ReturnType<typeof createEditor>, monaco: MonacoMock) => void
  options?: { readOnly?: boolean }
}

type MonacoMock = { editor: { setTheme: () => void } }

const createEditor = () => ({
  getContentHeight: () => 56,
  onDidFocusEditorText: () => ({ dispose: () => {} }),
  onDidBlurEditorText: () => ({ dispose: () => {} }),
})

const monaco: MonacoMock = { editor: { setTheme: () => {} } }

export function createMonacoEditorModuleMock() {
  function Editor({ value = '', onChange, onMount, options }: EditorProps) {
    const editorRef = useRef(createEditor())
    useEffect(() => {
      onMount?.(editorRef.current, monaco)
    }, [onMount])
    return (
      <textarea
        data-testid="monaco-editor"
        readOnly={options?.readOnly}
        value={value}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange?.(event.target.value)}
      />
    )
  }

  return {
    Editor,
    default: Editor,
    DiffEditor: Editor,
    loader: { config: () => {} },
  }
}
