import type { LexicalEditor } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useEffect } from 'react'

type CaptureEditorPluginProps = {
  onReady: (editor: LexicalEditor) => void
}

export const CaptureEditorPlugin = ({ onReady }: CaptureEditorPluginProps) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    onReady(editor)
  }, [editor, onReady])

  return null
}
