'use client'

import { memo } from 'react'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import LexicalErrorBoundary from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
// import TreeView from './plugins/tree-view'
import Placeholder from '@/app/components/base/prompt-editor/plugins/placeholder'

type EditorProps = {
  placeholder?: string
}
const Editor = ({
  placeholder,
}: EditorProps) => {
  return (
    <div className='relative h-full'>
      <RichTextPlugin
        contentEditable={<ContentEditable />}
        placeholder={<Placeholder value={placeholder} />}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      {/* <TreeView /> */}
    </div>
  )
}

export default memo(Editor)
