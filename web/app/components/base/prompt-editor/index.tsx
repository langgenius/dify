'use client'

import { type FC } from 'react'
import { useRef } from 'react'
// import { $getRoot } from 'lexical'
import type { EditorState } from 'lexical'
import { TextNode } from 'lexical'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import LexicalErrorBoundary from '@lexical/react/LexicalErrorBoundary'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
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
import { VariableValueBlockNode } from './plugins/variable-value-block/node'
import { CustomTextNode } from './plugins/custom-text/node'

export type PromptEditorProps = {
  editable?: boolean
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

const PromptEditor: FC<PromptEditorProps> = ({
  editable = true,
}) => {
  const editorStateRef = useRef<EditorState>()
  const initialEditorState = `{
    "root": {
        "children": [
            {
                "children": [
                    {
                        "detail": 0,
                        "format": 0,
                        "mode": "normal",
                        "style": "",
                        "text": "a ",
                        "type": "custom-text",
                        "version": 1
                    },
                    {
                        "type": "context-block",
                        "version": 1,
                        "datasets": [
                            {
                                "id": "1",
                                "name": "1",
                                "type": "file"
                            }
                        ]
                    },
                    {
                        "type": "query-block",
                        "version": 1
                    },
                    {
                        "detail": 0,
                        "format": 0,
                        "mode": "normal",
                        "style": "",
                        "text": "{{user}}",
                        "type": "variable-value-block",
                        "version": 1
                    }
                ],
                "direction": "ltr",
                "format": "",
                "indent": 0,
                "type": "paragraph",
                "version": 1
            }
        ],
        "direction": "ltr",
        "format": "",
        "indent": 0,
        "type": "root",
        "version": 1
    }
}`
  const initialConfig = {
    namespace: 'prompt-editor',
    onError: (error: Error) => {
      throw error
    },
    nodes: [
      CustomTextNode,
      {
        replace: TextNode,
        with: (node: TextNode) => new CustomTextNode(node.__text),
      },
      ContextBlockNode,
      HistoryBlockNode,
      QueryBlockNode,
      VariableValueBlockNode,
    ],
    editorState: initialEditorState,
  }

  const handleEditorChange = (editorState: EditorState) => {
    console.log(editorState.toJSON())
    editorStateRef.current = editorState
  }

  return (
    <LexicalComposer initialConfig={{ ...initialConfig, editable }}>
      <div className='relative'>
        <RichTextPlugin
          contentEditable={<ContentEditable className='outline-none text-sm text-gray-700 leading-6' />}
          placeholder={<Placeholder />}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <ComponentPicker />
        <VariablePicker items={[]} />
        <ContextBlock datasets={[]} />
        <VariableBlock />
        <HistoryBlock roleName={{
          user: 'master',
          assistant: 'box',
        }} />
        <QueryBlock />
        <VariableValueBlock />
        <TreeView />
        <OnChangePlugin onChange={handleEditorChange} />
      </div>
    </LexicalComposer>
  )
}

export default PromptEditor
