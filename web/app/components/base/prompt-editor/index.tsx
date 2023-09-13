'use client'

// import { $getRoot } from 'lexical'
// import type { EditorState } from 'lexical'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import LexicalErrorBoundary from '@lexical/react/LexicalErrorBoundary'
// import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import TreeView from './plugins/tree-view'
import Placeholder from './plugins/placeholder'
import ComponentPicker from './plugins/component-picker'
import VariablePicker from './plugins/variable-picker'
import ContextBlock from './plugins/context-block'
import { ContextBlockNode } from './plugins/context-block/node'
import HistoryBlock from './plugins/history-block'
import { HistoryBlockNode } from './plugins/history-block/node'
import QueryBlock from './plugins/query-block'
import { QueryBlockNode } from './plugins/query-block/node'
import VariableBlock from './plugins/variable-block'
import VariableValueBlock from './plugins/variable-value-block'
import { VariableValueNode } from './plugins/variable-value-block/node'

export type PromptEditorProps = {
  contextBlock?: {
    enable: boolean
    selectable: boolean
    addedContext: []
    onAddContext: () => void
  }
  variableBlock?: {
    enable: boolean
    selectable: boolean
    variables: []
    onAddVariable: () => void
  }
  historyBlock?: {
    enable: boolean
    selectable: boolean
    history: {
      user: string
      assistant: string
    }
  }
  queryBlock?: {
    enable: boolean
    selectable: boolean
  }
}

const PromptEditor = () => {
  const initialConfig = {
    namespace: 'prompt-editor',
    onError: (error: Error) => {
      throw error
    },
    nodes: [ContextBlockNode, HistoryBlockNode, QueryBlockNode, VariableValueNode],
  }

  // const handleEditorChange = (editorState: EditorState) => {
  //   console.log(editorState.read(() => $getRoot().getTextContent()))
  // }

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
        <VariableBlock />
        <HistoryBlock />
        <QueryBlock />
        <VariableValueBlock />
        <TreeView />
        {/* <OnChangePlugin onChange={handleEditorChange} /> */}
      </div>
    </LexicalComposer>
  )
}

export default PromptEditor
