'use client'

import type { InitialConfigType } from '@lexical/react/LexicalComposer'
import type {
  EditorState,
  LexicalCommand,
} from 'lexical'
import type { FC } from 'react'
import type { Hotkey } from './plugins/shortcuts-popup-plugin'
import type {
  ContextBlockType,
  CurrentBlockType,
  ErrorMessageBlockType,
  ExternalToolBlockType,
  HistoryBlockType,
  HITLInputBlockType,
  LastRunBlockType,
  QueryBlockType,
  RequestURLBlockType,
  VariableBlockType,
  WorkflowVariableBlockType,
} from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { CodeNode } from '@lexical/code'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  TextNode,
} from 'lexical'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import {
  UPDATE_DATASETS_EVENT_EMITTER,
  UPDATE_HISTORY_EVENT_EMITTER,
} from './constants'
import {
  ContextBlockNode,
} from './plugins/context-block'
import {
  CurrentBlockNode,
} from './plugins/current-block'
import { CustomTextNode } from './plugins/custom-text/node'
import {
  ErrorMessageBlockNode,
} from './plugins/error-message-block'
import {
  HistoryBlockNode,
} from './plugins/history-block'

import {
  HITLInputNode,
} from './plugins/hitl-input-block'
import {
  LastRunBlockNode,
} from './plugins/last-run-block'
import {
  QueryBlockNode,
} from './plugins/query-block'
import {
  RequestURLBlockNode,
} from './plugins/request-url-block'
import { VariableValueBlockNode } from './plugins/variable-value-block/node'
import {
  WorkflowVariableBlockNode,
} from './plugins/workflow-variable-block'
import PromptEditorContent from './prompt-editor-content'
import { textToEditorState } from './utils'

const ValueSyncPlugin: FC<{ value?: string }> = ({ value }) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (value === undefined)
      return

    const incomingValue = value ?? ''
    const shouldUpdate = editor.getEditorState().read(() => {
      const currentText = $getRoot().getChildren().map(node => node.getTextContent()).join('\n')
      return currentText !== incomingValue
    })

    if (!shouldUpdate)
      return

    const editorState = editor.parseEditorState(textToEditorState(incomingValue))
    editor.setEditorState(editorState)
    editor.update(() => {
      $getRoot().getAllTextNodes().forEach((node) => {
        if (node instanceof CustomTextNode)
          node.markDirty()
      })
    })
  }, [editor, value])

  return null
}

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
  requestURLBlock?: RequestURLBlockType
  historyBlock?: HistoryBlockType
  variableBlock?: VariableBlockType
  externalToolBlock?: ExternalToolBlockType
  workflowVariableBlock?: WorkflowVariableBlockType
  hitlInputBlock?: HITLInputBlockType
  currentBlock?: CurrentBlockType
  errorMessageBlock?: ErrorMessageBlockType
  lastRunBlock?: LastRunBlockType
  isSupportFileVar?: boolean
  shortcutPopups?: Array<{ hotkey: Hotkey, Popup: React.ComponentType<{ onClose: () => void, onInsert: (command: LexicalCommand<unknown>, params: any[]) => void }> }>
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
  requestURLBlock,
  historyBlock,
  variableBlock,
  externalToolBlock,
  workflowVariableBlock,
  hitlInputBlock,
  currentBlock,
  errorMessageBlock,
  lastRunBlock,
  isSupportFileVar,
  shortcutPopups = [],
}) => {
  const { eventEmitter } = useEventEmitterContextContext()
  const initialConfig: InitialConfigType = {
    theme: {
      paragraph: 'group-[.clamp]:line-clamp-5 group-focus/editable:line-clamp-none!',
    },
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
      RequestURLBlockNode,
      WorkflowVariableBlockNode,
      VariableValueBlockNode,
      HITLInputNode,
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

  const [floatingAnchorElem, setFloatingAnchorElem] = useState<HTMLDivElement | null>(null)

  const onRef = useCallback((nextFloatingAnchorElem: HTMLDivElement | null) => {
    setFloatingAnchorElem((currentFloatingAnchorElem) => {
      if (currentFloatingAnchorElem === nextFloatingAnchorElem)
        return currentFloatingAnchorElem

      return nextFloatingAnchorElem
    })
  }, [])

  return (
    <LexicalComposer initialConfig={{ ...initialConfig, editable }}>
      <div className={cn('relative', wrapperClassName)} ref={onRef}>
        <PromptEditorContent
          compact={compact}
          className={className}
          placeholder={placeholder}
          placeholderClassName={placeholderClassName}
          style={style}
          shortcutPopups={shortcutPopups}
          contextBlock={contextBlock}
          queryBlock={queryBlock}
          requestURLBlock={requestURLBlock}
          historyBlock={historyBlock}
          variableBlock={variableBlock}
          externalToolBlock={externalToolBlock}
          workflowVariableBlock={workflowVariableBlock}
          hitlInputBlock={hitlInputBlock}
          currentBlock={currentBlock}
          errorMessageBlock={errorMessageBlock}
          lastRunBlock={lastRunBlock}
          isSupportFileVar={isSupportFileVar}
          onBlur={onBlur}
          onFocus={onFocus}
          instanceId={instanceId}
          floatingAnchorElem={floatingAnchorElem}
          onEditorChange={handleEditorChange}
        />
        <ValueSyncPlugin value={value} />
      </div>
    </LexicalComposer>
  )
}

export default PromptEditor
