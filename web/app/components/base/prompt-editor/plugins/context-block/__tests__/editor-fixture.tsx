import type { ContextBlockType } from '../../../types'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { $getRoot, TextNode } from 'lexical'
import { useState } from 'react'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { TestLexicalComposer } from '@/test/lexical'
import { UPDATE_DATASETS_EVENT_EMITTER } from '../../../constants'
import { CustomTextNode } from '../../custom-text/node'
import { ContextBlock, ContextBlockReplacementBlock, INSERT_CONTEXT_BLOCK_COMMAND } from '../index'
import { ContextBlockNode } from '../node'
import { datasets } from './datasets'

function EditorActions() {
  const [editor] = useLexicalComposerContext()
  const { eventEmitter } = useEventEmitterContextContext()
  return (
    <>
      <button
        type="button"
        onClick={() => editor.dispatchCommand(INSERT_CONTEXT_BLOCK_COMMAND, undefined)}
      >
        Insert context
      </button>
      <button
        type="button"
        onClick={() =>
          eventEmitter!.emit({ type: UPDATE_DATASETS_EVENT_EMITTER, payload: datasets })
        }
      >
        Update datasets
      </button>
      <button
        type="button"
        onClick={() => eventEmitter!.emit({ type: UPDATE_DATASETS_EVENT_EMITTER, payload: [] })}
      >
        Clear datasets
      </button>
      <button
        type="button"
        onClick={() => eventEmitter!.emit({ type: 'other-event', payload: [] })}
      >
        Unrelated event
      </button>
    </>
  )
}

export function ContextEditor(props: ContextBlockType) {
  const [prompt, setPrompt] = useState('')
  return (
    <EventEmitterContextProvider>
      <TestLexicalComposer
        initialConfig={{
          namespace: 'context-browser',
          nodes: [
            CustomTextNode,
            ContextBlockNode,
            {
              replace: TextNode,
              with: (node: TextNode) => new CustomTextNode(node.getTextContent()),
              withKlass: CustomTextNode,
            },
          ],
          onError: (error) => {
            throw error
          },
        }}
      >
        <EditorActions />
        <RichTextPlugin
          contentEditable={<ContentEditable aria-label="Prompt" className="min-h-20 border p-2" />}
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <ContextBlock {...props} />
        <ContextBlockReplacementBlock {...props} />
        <OnChangePlugin
          onChange={(state) => state.read(() => setPrompt($getRoot().getTextContent()))}
        />
        <output aria-label="Saved prompt">{prompt}</output>
      </TestLexicalComposer>
    </EventEmitterContextProvider>
  )
}
