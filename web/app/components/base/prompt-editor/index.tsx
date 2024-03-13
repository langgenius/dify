'use client'

import type { FC } from 'react'
import { useEffect } from 'react'
import type {
  EditorState,
} from 'lexical'
import {
  $getRoot,
  TextNode,
} from 'lexical'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
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
import OnBlurBlock from './plugins/on-blur-block'
import UpdateBlock from './plugins/update-block'
import { textToEditorState } from './utils'
import type { Dataset } from './plugins/context-block'
import type { RoleName } from './plugins/history-block'
import type { ExternalToolOption, Option } from './plugins/variable-picker'
import {
  UPDATE_DATASETS_EVENT_EMITTER,
  UPDATE_HISTORY_EVENT_EMITTER,
} from './constants'
import { useEventEmitterContextContext } from '@/context/event-emitter'

export type PromptEditorProps = {
  className?: string
  value?: string
  editable?: boolean
  onChange?: (text: string) => void
  onBlur?: () => void
  contextBlock?: {
    show?: boolean
    selectable?: boolean
    datasets: Dataset[]
    onInsert?: () => void
    onDelete?: () => void
    onAddContext: () => void
  }
  variableBlock?: {
    selectable?: boolean
    variables: Option[]
    externalTools?: ExternalToolOption[]
    onAddExternalTool?: () => void
  }
  historyBlock?: {
    show?: boolean
    selectable?: boolean
    history: RoleName
    onInsert?: () => void
    onDelete?: () => void
    onEditRole: () => void
  }
  queryBlock?: {
    show?: boolean
    selectable?: boolean
    onInsert?: () => void
    onDelete?: () => void
  }
}

const PromptEditor: FC<PromptEditorProps> = ({
  className,
  value,
  editable = true,
  onChange,
  onBlur,
  contextBlock = {
    show: true,
    selectable: true,
    datasets: [],
    onAddContext: () => {},
    onInsert: () => {},
    onDelete: () => {},
  },
  historyBlock = {
    show: true,
    selectable: true,
    history: {
      user: '',
      assistant: '',
    },
    onEditRole: () => {},
    onInsert: () => {},
    onDelete: () => {},
  },
  variableBlock = {
    variables: [],
  },
  queryBlock = {
    show: true,
    selectable: true,
    onInsert: () => {},
    onDelete: () => {},
  },
}) => {
  const { eventEmitter } = useEventEmitterContextContext()
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
    editorState: value ? textToEditorState(value as string) : null,
    onError: (error: Error) => {
      throw error
    },
  }

  const handleEditorChange = (editorState: EditorState) => {
    const text = editorState.read(() => $getRoot().getTextContent())
    if (onChange)
      onChange(text.replaceAll('\n\n', '\n'))
  }

  useEffect(() => {
    eventEmitter?.emit({
      type: UPDATE_DATASETS_EVENT_EMITTER,
      payload: contextBlock.datasets,
    } as any)
  }, [eventEmitter, contextBlock.datasets])
  useEffect(() => {
    eventEmitter?.emit({
      type: UPDATE_HISTORY_EVENT_EMITTER,
      payload: historyBlock.history,
    } as any)
  }, [eventEmitter, historyBlock.history])

  return (
    <LexicalComposer initialConfig={{ ...initialConfig, editable }}>
      <div className='relative'>
        <RichTextPlugin
          contentEditable={<ContentEditable className={`${className} outline-none text-sm text-gray-700 leading-6`} />}
          placeholder={<Placeholder />}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <ComponentPicker
          contextDisabled={!contextBlock.selectable}
          contextShow={contextBlock.show}
          historyDisabled={!historyBlock.selectable}
          historyShow={historyBlock.show}
          queryDisabled={!queryBlock.selectable}
          queryShow={queryBlock.show}
        />
        <VariablePicker
          items={variableBlock.variables}
          externalTools={variableBlock.externalTools}
          onAddExternalTool={variableBlock.onAddExternalTool}
        />
        {
          contextBlock.show && (
            <>
              <ContextBlock
                datasets={contextBlock.datasets}
                onAddContext={contextBlock.onAddContext}
                onInsert={contextBlock.onInsert}
                onDelete={contextBlock.onDelete}
              />
              <ContextBlockReplacementBlock
                datasets={contextBlock.datasets}
                onAddContext={contextBlock.onAddContext}
                onInsert={contextBlock.onInsert}
              />
            </>
          )
        }
        <VariableBlock />
        {
          historyBlock.show && (
            <>
              <HistoryBlock
                roleName={historyBlock.history}
                onEditRole={historyBlock.onEditRole}
                onInsert={historyBlock.onInsert}
                onDelete={historyBlock.onDelete}
              />
              <HistoryBlockReplacementBlock
                roleName={historyBlock.history}
                onEditRole={historyBlock.onEditRole}
                onInsert={historyBlock.onInsert}
              />
            </>
          )
        }
        {
          queryBlock.show && (
            <>
              <QueryBlock
                onInsert={queryBlock.onInsert}
                onDelete={queryBlock.onDelete}
              />
              <QueryBlockReplacementBlock />
            </>
          )
        }
        <VariableValueBlock />
        <OnChangePlugin onChange={handleEditorChange} />
        <OnBlurBlock onBlur={onBlur} />
        <UpdateBlock />
        {/* <TreeView /> */}
      </div>
    </LexicalComposer>
  )
}

export default PromptEditor
