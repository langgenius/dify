'use client'

import type { EditorState } from 'lexical'
import { ClickableLinkPlugin } from '@lexical/react/LexicalClickableLinkPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import {
  memo,
  useCallback,
} from 'react'
// import TreeView from '@/app/components/base/prompt-editor/plugins/tree-view'
import Placeholder from '@/app/components/base/prompt-editor/plugins/placeholder'
import FormatDetectorPlugin from './plugins/format-detector-plugin'
import LinkEditorPlugin from './plugins/link-editor-plugin'

type EditorProps = {
  placeholder?: string
  onChange?: (editorState: EditorState) => void
  containerElement: HTMLDivElement | null
  setShortcutsEnabled?: (v: boolean) => void
}
const Editor = ({
  placeholder = 'write you note...',
  onChange,
  containerElement,
  setShortcutsEnabled,
}: EditorProps) => {
  const handleEditorChange = useCallback((editorState: EditorState) => {
    onChange?.(editorState)
  }, [onChange])

  return (
    <div className="relative">
      <RichTextPlugin
        contentEditable={(
          <div>
            <ContentEditable
              onFocus={() => setShortcutsEnabled?.(false)}
              onBlur={() => setShortcutsEnabled?.(true)}
              spellCheck={false}
              className="h-full w-full text-text-secondary caret-primary-600 outline-none"
            />
          </div>
        )}
        placeholder={<Placeholder value={placeholder} compact />}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <ClickableLinkPlugin disabled />
      <LinkPlugin />
      <ListPlugin />
      <LinkEditorPlugin containerElement={containerElement} />
      <FormatDetectorPlugin />
      <HistoryPlugin />
      <OnChangePlugin onChange={handleEditorChange} />
      {/* <TreeView /> */}
    </div>
  )
}

export default memo(Editor)
