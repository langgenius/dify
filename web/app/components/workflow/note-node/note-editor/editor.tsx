'use client'

import {
  memo,
  useCallback,
} from 'react'
import type { EditorState } from 'lexical'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { ClickableLinkPlugin } from '@lexical/react/LexicalClickableLinkPlugin'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { useWorkflowHistoryStore } from '../../workflow-history-store'
import LinkEditorPlugin from './plugins/link-editor-plugin'
import FormatDetectorPlugin from './plugins/format-detector-plugin'
// import TreeView from '@/app/components/base/prompt-editor/plugins/tree-view'
import Placeholder from '@/app/components/base/prompt-editor/plugins/placeholder'

type EditorProps = {
  placeholder?: string
  onChange?: (editorState: EditorState) => void
  containerElement: HTMLDivElement | null
}
const Editor = ({
  placeholder = 'write you note...',
  onChange,
  containerElement,
}: EditorProps) => {
  const handleEditorChange = useCallback((editorState: EditorState) => {
    onChange?.(editorState)
  }, [onChange])

  const { setShortcutsEnabled } = useWorkflowHistoryStore()

  return (
    <div className='relative'>
      <RichTextPlugin
        contentEditable={
          <div>
            <ContentEditable
              onFocus={() => setShortcutsEnabled(false)}
              onBlur={() => setShortcutsEnabled(true)}
              spellCheck={false}
              className='w-full h-full outline-none text-text-secondary caret-primary-600'
              placeholder={placeholder}
            />
          </div>
        }
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
