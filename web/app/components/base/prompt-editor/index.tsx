'use client'

import type { InitialConfigType } from '@lexical/react/LexicalComposer'
import type { EditorState } from 'lexical'
import type { FC } from 'react'
import type {
  Hotkey,
  ShortcutPopupDisplayMode,
  ShortcutPopupInsertHandler,
} from './plugins/shortcuts-popup-plugin'
import type {
  AgentOutputBlockType,
  ContextBlockType,
  CurrentBlockType,
  ErrorMessageBlockType,
  ExternalToolBlockType,
  HistoryBlockType,
  HITLInputBlockType,
  LastRunBlockType,
  QueryBlockType,
  RequestURLBlockType,
  RosterReferenceBlockType,
  VariableBlockType,
  WorkflowVariableBlockType,
} from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { CodeNode } from '@lexical/code'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot, TextNode } from 'lexical'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { UPDATE_DATASETS_EVENT_EMITTER, UPDATE_HISTORY_EVENT_EMITTER } from './constants'
import { AgentOutputBlockNode } from './plugins/agent-output-block/node'
import { ContextBlockNode } from './plugins/context-block'
import { CurrentBlockNode } from './plugins/current-block'
import { CustomTextNode } from './plugins/custom-text/node'
import { ErrorMessageBlockNode } from './plugins/error-message-block'
import { HistoryBlockNode } from './plugins/history-block'
import { HITLInputNode } from './plugins/hitl-input-block'
import { LastRunBlockNode } from './plugins/last-run-block'
import { QueryBlockNode } from './plugins/query-block'
import { RequestURLBlockNode } from './plugins/request-url-block'
import { RosterReferenceBlockNode } from './plugins/roster-reference-block/node'
import { VariableValueBlockNode } from './plugins/variable-value-block/node'
import { WorkflowVariableBlockNode } from './plugins/workflow-variable-block'
import PromptEditorContent from './prompt-editor-content'
import { textToEditorState } from './utils'

const ValueSyncPlugin: FC<{ value?: string }> = ({ value }) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (value === undefined) return

    const incomingValue = value ?? ''
    const shouldUpdate = editor.getEditorState().read(() => {
      const currentText = $getRoot()
        .getChildren()
        .map((node) => node.getTextContent())
        .join('\n')
      return currentText !== incomingValue
    })

    if (!shouldUpdate) return

    const editorState = editor.parseEditorState(textToEditorState(incomingValue))
    editor.setEditorState(editorState)
    editor.update(() => {
      $getRoot()
        .getAllTextNodes()
        .forEach((node) => {
          if (node instanceof CustomTextNode) node.markDirty()
        })
    })
  }, [editor, value])

  return null
}

const EditableSyncPlugin: FC<{ editable: boolean }> = ({ editable }) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    editor.setEditable(editable)
  }, [editor, editable])

  return null
}

type PromptEditorAriaProps = Pick<
  React.AriaAttributes,
  'aria-controls' | 'aria-haspopup' | 'aria-label' | 'aria-labelledby'
>

export type PromptEditorProps = PromptEditorAriaProps & {
  instanceId?: string
  children?: React.ReactNode
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
  rosterReferenceBlock?: RosterReferenceBlockType
  externalToolBlock?: ExternalToolBlockType
  workflowVariableBlock?: WorkflowVariableBlockType
  agentOutputBlock?: AgentOutputBlockType
  hitlInputBlock?: HITLInputBlockType
  currentBlock?: CurrentBlockType
  errorMessageBlock?: ErrorMessageBlockType
  lastRunBlock?: LastRunBlockType
  isSupportFileVar?: boolean
  disableSlashPicker?: boolean
  disableBracePicker?: boolean
  shortcutPopups?: Array<{
    hotkey: Hotkey
    displayMode?: ShortcutPopupDisplayMode
    Popup: React.ComponentType<{ onClose: () => void; onInsert: ShortcutPopupInsertHandler }>
  }>
}

const PromptEditor: FC<PromptEditorProps> = ({
  'aria-controls': ariaControls,
  'aria-haspopup': ariaHasPopup,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  instanceId,
  children,
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
  rosterReferenceBlock,
  externalToolBlock,
  workflowVariableBlock,
  agentOutputBlock,
  hitlInputBlock,
  currentBlock,
  errorMessageBlock,
  lastRunBlock,
  isSupportFileVar,
  disableSlashPicker = false,
  disableBracePicker = false,
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
        withKlass: CustomTextNode,
      },
      ContextBlockNode,
      HistoryBlockNode,
      QueryBlockNode,
      RequestURLBlockNode,
      WorkflowVariableBlockNode,
      VariableValueBlockNode,
      RosterReferenceBlockNode,
      HITLInputNode,
      CurrentBlockNode,
      ErrorMessageBlockNode,
      LastRunBlockNode, // LastRunBlockNode is used for error message block replacement
      AgentOutputBlockNode,
    ],
    editorState: textToEditorState(value || ''),
    onError: (error: Error) => {
      throw error
    },
  }

  const handleEditorChange = (editorState: EditorState) => {
    const text = editorState.read(() => {
      return $getRoot()
        .getChildren()
        .map((p) => p.getTextContent())
        .join('\n')
    })
    if (onChange) onChange(text)
  }

  useEffect(() => {
    eventEmitter?.emit({
      type: UPDATE_DATASETS_EVENT_EMITTER,
      payload: contextBlock?.datasets,
    })
  }, [eventEmitter, contextBlock?.datasets])
  useEffect(() => {
    eventEmitter?.emit({
      type: UPDATE_HISTORY_EVENT_EMITTER,
      payload: historyBlock?.history,
    })
  }, [eventEmitter, historyBlock?.history])

  const [floatingAnchorElem, setFloatingAnchorElem] = useState<HTMLDivElement | null>(null)

  const onRef = useCallback((nextFloatingAnchorElem: HTMLDivElement | null) => {
    setFloatingAnchorElem((currentFloatingAnchorElem) => {
      if (currentFloatingAnchorElem === nextFloatingAnchorElem) return currentFloatingAnchorElem

      return nextFloatingAnchorElem
    })
  }, [])

  return (
    <LexicalComposer initialConfig={{ ...initialConfig, editable }}>
      <div className={cn('relative', wrapperClassName)} ref={onRef}>
        <PromptEditorContent
          aria-controls={ariaControls}
          aria-haspopup={ariaHasPopup}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
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
          rosterReferenceBlock={rosterReferenceBlock}
          externalToolBlock={externalToolBlock}
          workflowVariableBlock={workflowVariableBlock}
          agentOutputBlock={agentOutputBlock}
          hitlInputBlock={hitlInputBlock}
          currentBlock={currentBlock}
          errorMessageBlock={errorMessageBlock}
          lastRunBlock={lastRunBlock}
          isSupportFileVar={isSupportFileVar}
          disableSlashPicker={disableSlashPicker}
          disableBracePicker={disableBracePicker}
          onBlur={onBlur}
          onFocus={onFocus}
          instanceId={instanceId}
          floatingAnchorElem={floatingAnchorElem}
          onEditorChange={handleEditorChange}
        />
        <ValueSyncPlugin value={value} />
        <EditableSyncPlugin editable={editable} />
        {children}
      </div>
    </LexicalComposer>
  )
}

export default PromptEditor
