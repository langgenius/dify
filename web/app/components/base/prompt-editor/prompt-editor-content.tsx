import type { EditorState } from 'lexical'
import type { FC } from 'react'
import type { Hotkey, ShortcutPopupDisplayMode, ShortcutPopupInsertHandler } from './plugins/shortcuts-popup-plugin'
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
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import * as React from 'react'
import {
  AgentOutputBlock,
  AgentOutputBlockReplacementBlock,
} from './plugins/agent-output-block'
import ComponentPickerBlock from './plugins/component-picker-block'
import {
  ContextBlock,
  ContextBlockReplacementBlock,
} from './plugins/context-block'
import {
  CurrentBlock,
  CurrentBlockReplacementBlock,
} from './plugins/current-block'
import DraggableBlockPlugin from './plugins/draggable-plugin'
import {
  ErrorMessageBlock,
  ErrorMessageBlockReplacementBlock,
} from './plugins/error-message-block'
import {
  HistoryBlock,
  HistoryBlockReplacementBlock,
} from './plugins/history-block'
import {
  HITLInputBlock,
  HITLInputBlockReplacementBlock,
} from './plugins/hitl-input-block'
import {
  LastRunBlock,
  LastRunReplacementBlock,
} from './plugins/last-run-block'
import OnBlurBlock from './plugins/on-blur-or-focus-block'
import Placeholder from './plugins/placeholder'
import {
  QueryBlock,
  QueryBlockReplacementBlock,
} from './plugins/query-block'
import {
  RequestURLBlock,
  RequestURLBlockReplacementBlock,
} from './plugins/request-url-block'
import RosterReferenceBlock from './plugins/roster-reference-block'
import { RosterReferenceBlockContext } from './plugins/roster-reference-block/context'
import ShortcutsPopupPlugin from './plugins/shortcuts-popup-plugin'
import UpdateBlock from './plugins/update-block'
import VariableBlock from './plugins/variable-block'
import VariableValueBlock from './plugins/variable-value-block'
import {
  WorkflowVariableBlock,
  WorkflowVariableBlockReplacementBlock,
} from './plugins/workflow-variable-block'

type ShortcutPopup = {
  hotkey: Hotkey
  displayMode?: ShortcutPopupDisplayMode
  Popup: React.ComponentType<{ onClose: () => void, onInsert: ShortcutPopupInsertHandler }>
}

type PromptEditorContentAriaProps = Pick<React.AriaAttributes, 'aria-label' | 'aria-labelledby'>

type PromptEditorContentProps = PromptEditorContentAriaProps & {
  compact?: boolean
  className?: string
  placeholder?: string | React.ReactNode
  placeholderClassName?: string
  style?: React.CSSProperties
  shortcutPopups: ShortcutPopup[]
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
  onBlur?: () => void
  onFocus?: () => void
  instanceId?: string
  floatingAnchorElem: HTMLDivElement | null
  onEditorChange: (editorState: EditorState) => void
}

const PromptEditorContent: FC<PromptEditorContentProps> = ({
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  compact,
  className,
  placeholder,
  placeholderClassName,
  style,
  shortcutPopups,
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
  disableSlashPicker,
  disableBracePicker,
  onBlur,
  onFocus,
  instanceId,
  floatingAnchorElem,
  onEditorChange,
}) => {
  return (
    <RosterReferenceBlockContext value={rosterReferenceBlock}>
      <RichTextPlugin
        contentEditable={(
          <ContentEditable
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            className={cn(
              'group/editable text-text-secondary outline-hidden group-[.clamp]:max-h-24 group-[.clamp]:overflow-y-auto',
              compact ? 'text-[13px] leading-5' : 'text-sm/6',
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
      {shortcutPopups.map(({ hotkey, displayMode, Popup }, idx) => (
        <ShortcutsPopupPlugin key={idx} hotkey={hotkey} displayMode={displayMode}>
          {(closePortal, onInsert) => <Popup onClose={closePortal} onInsert={onInsert} />}
        </ShortcutsPopupPlugin>
      ))}
      {!disableSlashPicker && (
        <ComponentPickerBlock
          triggerString="/"
          contextBlock={contextBlock}
          historyBlock={historyBlock}
          queryBlock={queryBlock}
          requestURLBlock={requestURLBlock}
          variableBlock={variableBlock}
          externalToolBlock={externalToolBlock}
          workflowVariableBlock={workflowVariableBlock}
          agentOutputBlock={agentOutputBlock}
          currentBlock={currentBlock}
          errorMessageBlock={errorMessageBlock}
          lastRunBlock={lastRunBlock}
          isSupportFileVar={isSupportFileVar}
        />
      )}
      {!disableBracePicker && (
        <ComponentPickerBlock
          triggerString="{"
          contextBlock={contextBlock}
          historyBlock={historyBlock}
          queryBlock={queryBlock}
          requestURLBlock={requestURLBlock}
          variableBlock={variableBlock}
          externalToolBlock={externalToolBlock}
          workflowVariableBlock={workflowVariableBlock}
          agentOutputBlock={agentOutputBlock}
          currentBlock={currentBlock}
          errorMessageBlock={errorMessageBlock}
          lastRunBlock={lastRunBlock}
          isSupportFileVar={isSupportFileVar}
        />
      )}
      {contextBlock?.show && (
        <>
          <ContextBlock {...contextBlock} />
          <ContextBlockReplacementBlock {...contextBlock} />
        </>
      )}
      {queryBlock?.show && (
        <>
          <QueryBlock {...queryBlock} />
          <QueryBlockReplacementBlock />
        </>
      )}
      {historyBlock?.show && (
        <>
          <HistoryBlock {...historyBlock} />
          <HistoryBlockReplacementBlock {...historyBlock} />
        </>
      )}
      {(variableBlock?.show || externalToolBlock?.show) && (
        <>
          <VariableBlock />
          <VariableValueBlock />
        </>
      )}
      {rosterReferenceBlock?.show && (
        <RosterReferenceBlock />
      )}
      {workflowVariableBlock?.show && (
        <>
          <WorkflowVariableBlock {...workflowVariableBlock} />
          <WorkflowVariableBlockReplacementBlock {...workflowVariableBlock} />
        </>
      )}
      {agentOutputBlock?.show && (
        <>
          <AgentOutputBlock {...agentOutputBlock} />
          <AgentOutputBlockReplacementBlock {...agentOutputBlock} />
        </>
      )}
      {hitlInputBlock?.show && (
        <>
          <HITLInputBlock {...hitlInputBlock} />
          <HITLInputBlockReplacementBlock {...hitlInputBlock} />
        </>
      )}
      {currentBlock?.show && (
        <>
          <CurrentBlock {...currentBlock} />
          <CurrentBlockReplacementBlock {...currentBlock} />
        </>
      )}
      {requestURLBlock?.show && (
        <>
          <RequestURLBlock {...requestURLBlock} />
          <RequestURLBlockReplacementBlock {...requestURLBlock} />
        </>
      )}
      {errorMessageBlock?.show && (
        <>
          <ErrorMessageBlock {...errorMessageBlock} />
          <ErrorMessageBlockReplacementBlock {...errorMessageBlock} />
        </>
      )}
      {lastRunBlock?.show && (
        <>
          <LastRunBlock {...lastRunBlock} />
          <LastRunReplacementBlock {...lastRunBlock} />
        </>
      )}
      {isSupportFileVar && (
        <VariableValueBlock />
      )}
      <OnChangePlugin onChange={onEditorChange} />
      <OnBlurBlock onBlur={onBlur} onFocus={onFocus} />
      <UpdateBlock instanceId={instanceId} />
      <HistoryPlugin />
      {floatingAnchorElem && (
        <DraggableBlockPlugin anchorElem={floatingAnchorElem} />
      )}
    </RosterReferenceBlockContext>
  )
}

export default PromptEditorContent
