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
import { CodeNode } from '@lexical/code'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import LexicalErrorBoundary from '@lexical/react/LexicalErrorBoundary'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
// import TreeView from './plugins/tree-view'
import Placeholder from './plugins/placeholder'
import ComponentPickerBlock from './plugins/component-picker-block'
import {
  ContextBlock,
  ContextBlockNode,
  ContextBlockReplacementBlock,
} from './plugins/context-block'
import {
  QueryBlock,
  QueryBlockNode,
  QueryBlockReplacementBlock,
} from './plugins/query-block'
import {
  HistoryBlock,
  HistoryBlockNode,
  HistoryBlockReplacementBlock,
} from './plugins/history-block'
import {
  WorkflowVariableBlock,
  WorkflowVariableBlockNode,
  WorkflowVariableBlockReplacementBlock,
} from './plugins/workflow-variable-block'
import VariableBlock from './plugins/variable-block'
import VariableValueBlock from './plugins/variable-value-block'
import { VariableValueBlockNode } from './plugins/variable-value-block/node'
import { CustomTextNode } from './plugins/custom-text/node'
import OnBlurBlock from './plugins/on-blur-or-focus-block'
import UpdateBlock from './plugins/update-block'
import { textToEditorState } from './utils'
import type {
  ContextBlockType,
  ExternalToolBlockType,
  HistoryBlockType,
  QueryBlockType,
  VariableBlockType,
  WorkflowVariableBlockType,
} from './types'
import {
  UPDATE_DATASETS_EVENT_EMITTER,
  UPDATE_HISTORY_EVENT_EMITTER,
} from './constants'
import { useEventEmitterContextContext } from '@/context/event-emitter'

export type PromptEditorProps = {
  instanceId?: string
  compact?: boolean
  className?: string
  placeholder?: string
  placeholderClassName?: string
  style?: React.CSSProperties
  value?: string
  editable?: boolean
  onChange?: (text: string) => void
  onBlur?: () => void
  onFocus?: () => void
  contextBlock?: ContextBlockType
  queryBlock?: QueryBlockType
  historyBlock?: HistoryBlockType
  variableBlock?: VariableBlockType
  externalToolBlock?: ExternalToolBlockType
  workflowVariableBlock?: WorkflowVariableBlockType
}

const PromptEditor: FC<PromptEditorProps> = ({
  instanceId,
  compact,
  className,
  placeholder,
  placeholderClassName,
  style,
  value,
  editable = true,
  onChange,
  onBlur,
  onFocus,
  contextBlock,
  queryBlock,
  historyBlock,
  variableBlock,
  externalToolBlock,
  workflowVariableBlock,
}) => {
  const { eventEmitter } = useEventEmitterContextContext()
  const initialConfig = {
    namespace: 'prompt-editor',
    nodes: [
      CodeNode,
      CustomTextNode,
      {
        replace: TextNode,
        with: (node: TextNode) => new CustomTextNode(node.__text),
      },
      ContextBlockNode,
      HistoryBlockNode,
      QueryBlockNode,
      WorkflowVariableBlockNode,
      VariableValueBlockNode,
    ],
    editorState: textToEditorState(value || ''),
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
      payload: contextBlock?.datasets,
    } as any)
  }, [eventEmitter, contextBlock?.datasets])
  useEffect(() => {
    eventEmitter?.emit({
      type: UPDATE_HISTORY_EVENT_EMITTER,
      payload: historyBlock?.history,
    } as any)
  }, [eventEmitter, historyBlock?.history])

  return (
    <LexicalComposer initialConfig={{ ...initialConfig, editable }}>
      <div className='relative'>
        <RichTextPlugin
          contentEditable={<ContentEditable className={`${className} outline-none ${compact ? 'leading-5 text-[13px]' : 'leading-6 text-sm'} text-gray-700`} style={style || {}} />}
          placeholder={<Placeholder value={placeholder} className={placeholderClassName} compact={compact} />}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <ComponentPickerBlock
          triggerString='/'
          contextBlock={contextBlock}
          historyBlock={historyBlock}
          queryBlock={queryBlock}
          variableBlock={variableBlock}
          externalToolBlock={externalToolBlock}
          workflowVariableBlock={workflowVariableBlock}
        />
        <ComponentPickerBlock
          triggerString='{'
          contextBlock={contextBlock}
          historyBlock={historyBlock}
          queryBlock={queryBlock}
          variableBlock={variableBlock}
          externalToolBlock={externalToolBlock}
          workflowVariableBlock={workflowVariableBlock}
        />
        {
          contextBlock?.show && (
            <>
              <ContextBlock {...contextBlock} />
              <ContextBlockReplacementBlock {...contextBlock} />
            </>
          )
        }
        {
          queryBlock?.show && (
            <>
              <QueryBlock {...queryBlock} />
              <QueryBlockReplacementBlock />
            </>
          )
        }
        {
          historyBlock?.show && (
            <>
              <HistoryBlock {...historyBlock} />
              <HistoryBlockReplacementBlock {...historyBlock} />
            </>
          )
        }
        {
          (variableBlock?.show || externalToolBlock?.show) && (
            <>
              <VariableBlock />
              <VariableValueBlock />
            </>
          )
        }
        {
          workflowVariableBlock?.show && (
            <>
              <WorkflowVariableBlock {...workflowVariableBlock} />
              <WorkflowVariableBlockReplacementBlock {...workflowVariableBlock} />
            </>
          )
        }
        <OnChangePlugin onChange={handleEditorChange} />
        <OnBlurBlock onBlur={onBlur} onFocus={onFocus} />
        <UpdateBlock instanceId={instanceId} />
        <HistoryPlugin />
        {/* <TreeView /> */}
      </div>
    </LexicalComposer>
  )
}

export default PromptEditor
