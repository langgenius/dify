'use client'

import { type FC } from 'react'
import type {
  EditorState,
} from 'lexical'
import {
  $getRoot,
  TextNode,
} from 'lexical'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import type { InitialEditorStateType } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import LexicalErrorBoundary from '@lexical/react/LexicalErrorBoundary'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
// import TreeView from './plugins/tree-view'
import Placeholder from './plugins/placeholder'
import ComponentPicker from './plugins/component-picker'
import VariablePicker from './plugins/variable-picker'
import ContextBlock from './plugins/context-block'
import { ContextBlockNode } from './plugins/context-block/node'
import ContextBlockReplacementBlock from './plugins/context-block-replacement-block'
import HistoryBlock from './plugins/history-block'
import { HistoryBlockNode } from './plugins/history-block/node'
import HistoryBlockReplacementBlock from './plugins/history-block-replacement-block'
import QueryBlock from './plugins/query-block'
import { QueryBlockNode } from './plugins/query-block/node'
import QueryBlockReplacementBlock from './plugins/query-block-replacement-block'
import VariableBlock from './plugins/variable-block'
import VariableValueBlock from './plugins/variable-value-block'
import { VariableValueBlockNode } from './plugins/variable-value-block/node'
import { CustomTextNode } from './plugins/custom-text/node'
import type { Dataset } from './plugins/context-block'
import type { RoleName } from './plugins/history-block'
import type { Option } from './plugins/variable-picker'

export type PromptEditorProps = {
  value?: InitialEditorStateType
  editable?: boolean
  onChange?: (text: string) => void
  contextBlock?: {
    selectable?: boolean
    datasets: Dataset[]
    onInsert?: () => void
    onDelete?: () => void
    onAddContext: () => void
  }
  variableBlock?: {
    selectable?: boolean
    variables: Option[]
    onAddVariable: () => void
  }
  historyBlock?: {
    selectable?: boolean
    history: RoleName
    onInsert?: () => void
    onDelete?: () => void
    onEditRole: () => void
  }
  queryBlock?: {
    selectable?: boolean
    onInsert?: () => void
    onDelete?: () => void
  }
}

const PromptEditor: FC<PromptEditorProps> = ({
  value,
  editable = true,
  onChange,
  contextBlock = {
    selectable: true,
    datasets: [],
    onInsert: () => {},
    onDelete: () => {},
  },
  historyBlock = {
    selectable: true,
    history: {
      user: 'Human',
      assistant: 'Assistant',
    },
    onInsert: () => {},
    onDelete: () => {},
  },
  variableBlock = {
    variables: [],
  },
  queryBlock = {
    selectable: true,
    onInsert: () => {},
    onDelete: () => {},
  },
}) => {
  const initialConfig = {
    namespace: 'prompt-editor',
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
    editorState: value,
    onError: (error: Error) => {
      throw error
    },
  }

  const handleEditorChange = (editorState: EditorState) => {
    if (onChange)
      onChange(editorState.read(() => $getRoot().getTextContent()))
  }

  return (
    <LexicalComposer initialConfig={{ ...initialConfig, editable }}>
      <div className='relative'>
        <RichTextPlugin
          contentEditable={<ContentEditable className='outline-none text-sm text-gray-700 leading-6' />}
          placeholder={<Placeholder />}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <ComponentPicker
          contextDisabled={!contextBlock.selectable}
          historyDisabled={!historyBlock.selectable}
          queryDisabled={!queryBlock.selectable}
        />
        <VariablePicker items={variableBlock.variables} />
        <ContextBlock
          datasets={contextBlock.datasets}
          onInsert={contextBlock.onInsert}
          onDelete={contextBlock.onDelete}
        />
        <ContextBlockReplacementBlock
          datasets={contextBlock.datasets}
          onInsert={contextBlock.onInsert}
        />
        <VariableBlock />
        <HistoryBlock
          roleName={historyBlock.history}
          onInsert={historyBlock.onInsert}
          onDelete={historyBlock.onDelete}
        />
        <HistoryBlockReplacementBlock
          roleName={historyBlock.history}
          onInsert={historyBlock.onInsert}
        />
        <QueryBlock
          onInsert={queryBlock.onInsert}
          onDelete={queryBlock.onDelete}
        />
        <QueryBlockReplacementBlock />
        <VariableValueBlock />
        <OnChangePlugin onChange={handleEditorChange} />
        {/* <TreeView /> */}
      </div>
    </LexicalComposer>
  )
}

export default PromptEditor
