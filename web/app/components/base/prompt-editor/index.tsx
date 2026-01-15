'use client'

import type {
  EditorState,
} from 'lexical'
import type { FC } from 'react'
import type {
  ContextBlockType,
  CurrentBlockType,
  ErrorMessageBlockType,
  ExternalToolBlockType,
  HistoryBlockType,
  LastRunBlockType,
  QueryBlockType,
  VariableBlockType,
  WorkflowVariableBlockType,
} from './types'
import { CodeNode } from '@lexical/code'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import {
  $getRoot,
  TextNode,
} from 'lexical'
import * as React from 'react'
import { useEffect } from 'react'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { cn } from '@/utils/classnames'
import {
  UPDATE_DATASETS_EVENT_EMITTER,
  UPDATE_HISTORY_EVENT_EMITTER,
} from './constants'
import ComponentPickerBlock from './plugins/component-picker-block'
import {
  ContextBlock,
  ContextBlockNode,
  ContextBlockReplacementBlock,
} from './plugins/context-block'
import {
  CurrentBlock,
  CurrentBlockNode,
  CurrentBlockReplacementBlock,
} from './plugins/current-block'
import { CustomTextNode } from './plugins/custom-text/node'
import {
  ErrorMessageBlock,
  ErrorMessageBlockNode,
  ErrorMessageBlockReplacementBlock,
} from './plugins/error-message-block'

import {
  HistoryBlock,
  HistoryBlockNode,
  HistoryBlockReplacementBlock,
} from './plugins/history-block'
import {
  LastRunBlock,
  LastRunBlockNode,
  LastRunReplacementBlock,
} from './plugins/last-run-block'
import OnBlurBlock from './plugins/on-blur-or-focus-block'
// import TreeView from './plugins/tree-view'
import Placeholder from './plugins/placeholder'
import {
  QueryBlock,
  QueryBlockNode,
  QueryBlockReplacementBlock,
} from './plugins/query-block'
import UpdateBlock from './plugins/update-block'
import VariableBlock from './plugins/variable-block'
import VariableValueBlock from './plugins/variable-value-block'
import { VariableValueBlockNode } from './plugins/variable-value-block/node'
import {
  WorkflowVariableBlock,
  WorkflowVariableBlockNode,
  WorkflowVariableBlockReplacementBlock,
} from './plugins/workflow-variable-block'
import { textToEditorState } from './utils'

export type PromptEditorProps = {
  instanceId?: string
  compact?: boolean
  wrapperClassName?: string
  className?: string
  placeholder?: string | React.ReactNode
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
  currentBlock?: CurrentBlockType
  errorMessageBlock?: ErrorMessageBlockType
  lastRunBlock?: LastRunBlockType
  isSupportFileVar?: boolean
}

const PromptEditor: FC<PromptEditorProps> = ({
  instanceId,
  compact,
  wrapperClassName,
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
  currentBlock,
  errorMessageBlock,
  lastRunBlock,
  isSupportFileVar,
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
      CurrentBlockNode,
      ErrorMessageBlockNode,
      LastRunBlockNode, // LastRunBlockNode is used for error message block replacement
    ],
    editorState: textToEditorState(value || ''),
    onError: (error: Error) => {
      throw error
    },
  }

  const handleEditorChange = (editorState: EditorState) => {
    const text = editorState.read(() => {
      return $getRoot().getChildren().map(p => p.getTextContent()).join('\n')
    })
    if (onChange)
      onChange(text)
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
      <div className={cn('relative', wrapperClassName)}>
        <RichTextPlugin
          contentEditable={(
            <ContentEditable
              className={cn(
                'text-text-secondary outline-none',
                compact ? 'text-[13px] leading-5' : 'text-sm leading-6',
                className,
              )}
              style={style || {}}
            />
          )}
          placeholder={(
            <Placeholder
              value={placeholder}
              className={cn('truncate', placeholderClassName)}
              compact={compact}
            />
          )}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <ComponentPickerBlock
          triggerString="/"
          contextBlock={contextBlock}
          historyBlock={historyBlock}
          queryBlock={queryBlock}
          variableBlock={variableBlock}
          externalToolBlock={externalToolBlock}
          workflowVariableBlock={workflowVariableBlock}
          currentBlock={currentBlock}
          errorMessageBlock={errorMessageBlock}
          lastRunBlock={lastRunBlock}
          isSupportFileVar={isSupportFileVar}
        />
        <ComponentPickerBlock
          triggerString="{"
          contextBlock={contextBlock}
          historyBlock={historyBlock}
          queryBlock={queryBlock}
          variableBlock={variableBlock}
          externalToolBlock={externalToolBlock}
          workflowVariableBlock={workflowVariableBlock}
          currentBlock={currentBlock}
          errorMessageBlock={errorMessageBlock}
          lastRunBlock={lastRunBlock}
          isSupportFileVar={isSupportFileVar}
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
        {
          currentBlock?.show && (
            <>
              <CurrentBlock {...currentBlock} />
              <CurrentBlockReplacementBlock {...currentBlock} />
            </>
          )
        }
        {
          errorMessageBlock?.show && (
            <>
              <ErrorMessageBlock {...errorMessageBlock} />
              <ErrorMessageBlockReplacementBlock {...errorMessageBlock} />
            </>
          )
        }
        {
          lastRunBlock?.show && (
            <>
              <LastRunBlock {...lastRunBlock} />
              <LastRunReplacementBlock {...lastRunBlock} />
            </>
          )
        }
        {
          isSupportFileVar && (
            <VariableValueBlock />
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
