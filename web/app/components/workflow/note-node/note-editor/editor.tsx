'use client'

import {
  memo,
  useState,
} from 'react'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { ClickableLinkPlugin } from '@lexical/react/LexicalClickableLinkPlugin'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import LinkEditorPlugin from './plugins/link-editor-plugin'
import FormatDetectorPlugin from './plugins/format-detector-plugin'
import TreeView from '@/app/components/base/prompt-editor/plugins/tree-view'
import Placeholder from '@/app/components/base/prompt-editor/plugins/placeholder'

type EditorProps = {
  placeholder?: string
}
const Editor = ({
  placeholder = 'write you note...',
}: EditorProps) => {
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null)
  const onRef = (_containerElement: HTMLDivElement) => {
    if (_containerElement !== null)
      setContainerElement(_containerElement)
  }

  return (
    <div className='relative h-full'>
      <RichTextPlugin
        contentEditable={
          <div ref={onRef} className=''>
            <ContentEditable
              className='w-full h-full outline-none'
              placeholder={placeholder}
            />
          </div>
        }
        placeholder={<Placeholder value={placeholder} />}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <ClickableLinkPlugin disabled />
      <LinkPlugin />
      <LinkEditorPlugin
        containerElement={containerElement}
      />
      <FormatDetectorPlugin />
      <HistoryPlugin />
      <TreeView />
    </div>
  )
}

export default memo(Editor)
