'use client'

import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import LexicalErrorBoundary from '@lexical/react/LexicalErrorBoundary'
import TreeView from './plugins/tree-view'
import Placeholder from './plugins/placeholder'
import ComponentPicker from './plugins/component-picker'
import VariablePicker from './plugins/variable-picker'
import ContextBlock from './plugins/context-block'
import { ContextBlockNode } from './plugins/context-block/node'

const PromptEditor = () => {
  const initialConfig = {
    namespace: 'prompt-editor',
    onError: (error: Error) => {
      throw error
    },
    nodes: [ContextBlockNode],
  }

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className='relative'>
        <RichTextPlugin
          contentEditable={<ContentEditable className='outline-none text-sm leading-6' />}
          placeholder={<Placeholder />}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <ComponentPicker />
        <VariablePicker />
        <ContextBlock />
        <TreeView />
      </div>
    </LexicalComposer>
  )
}

export default PromptEditor
