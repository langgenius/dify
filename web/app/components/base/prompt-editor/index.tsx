'use client'

import type {
  EditorState,
  LexicalCommand,
} from 'lexical'
import type { FC } from 'react'
import type { Hotkey } from './plugins/shortcuts-popup-plugin'
import type {
  AgentBlockType,
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
import type { Node as WorkflowNode } from '@/app/components/workflow/types'
import type { EventPayload } from '@/context/event-emitter'
import { CodeNode } from '@lexical/code'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import {
  $getRoot,
  COMMAND_PRIORITY_LOW,
  KEY_ENTER_COMMAND,
  TextNode,
} from 'lexical'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { Trans } from 'react-i18next'
import { WorkflowContext } from '@/app/components/workflow/context'
import { HooksStoreContext } from '@/app/components/workflow/hooks-store/provider'
import { FileReferenceNode } from '@/app/components/workflow/skill/editor/skill-editor/plugins/file-reference-block/node'
import { FilePreviewContextProvider } from '@/app/components/workflow/skill/editor/skill-editor/plugins/file-reference-block/preview-context'
import FileReferenceReplacementBlock from '@/app/components/workflow/skill/editor/skill-editor/plugins/file-reference-block/replacement-block'
import {
  ToolBlock,
  ToolBlockNode,
  ToolBlockReplacementBlock,
  ToolGroupBlockNode,
  ToolGroupBlockReplacementBlock,
} from '@/app/components/workflow/skill/editor/skill-editor/plugins/tool-block'
import { ToolBlockContextProvider } from '@/app/components/workflow/skill/editor/skill-editor/plugins/tool-block/tool-block-context'
import ToolPickerBlock from '@/app/components/workflow/skill/editor/skill-editor/plugins/tool-block/tool-picker-block'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { cn } from '@/utils/classnames'
import { useWorkflow } from '../../workflow/hooks'
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
import DraggableBlockPlugin from './plugins/draggable-plugin'
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
  HITLInputBlock,
  HITLInputBlockReplacementBlock,
  HITLInputNode,
} from './plugins/hitl-input-block'
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
import {
  RequestURLBlock,
  RequestURLBlockNode,
  RequestURLBlockReplacementBlock,
} from './plugins/request-url-block'
import ShortcutsPopupPlugin from './plugins/shortcuts-popup-plugin'
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

const EnterCommandPlugin: FC<{ onEnter?: (event: KeyboardEvent) => void }> = ({ onEnter }) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!onEnter)
      return
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent) => {
        if (!event || event.defaultPrevented)
          return false
        if (event.isComposing || event.shiftKey)
          return false
        event.preventDefault()
        onEnter(event)
        return true
      },
      COMMAND_PRIORITY_LOW,
    )
  }, [editor, onEnter])

  return null
}

type WorkflowAvailableNodesProps = {
  nodeId?: string
  isSupportSandbox?: boolean
  children: (availableNodes: WorkflowNode[]) => React.ReactNode
}

const WorkflowAvailableNodes: FC<WorkflowAvailableNodesProps> = ({
  nodeId,
  isSupportSandbox,
  children,
}) => {
  const { getBeforeNodesInSameBranch } = useWorkflow()
  const availableNodes = React.useMemo(
    () => nodeId && isSupportSandbox ? getBeforeNodesInSameBranch(nodeId || '') : [],
    [getBeforeNodesInSameBranch, isSupportSandbox, nodeId],
  )

  return (
    <>
      {children(availableNodes)}
    </>
  )
}

export type PromptEditorProps = {
  instanceId?: string
  nodeId?: string
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
  toolMetadata?: Record<string, unknown>
  onToolMetadataChange?: (metadata: Record<string, unknown>) => void
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
  agentBlock?: AgentBlockType
  isSupportFileVar?: boolean
  isSupportSandbox?: boolean
  disableToolBlocks?: boolean
  onEnter?: (event: KeyboardEvent) => void
  shortcutPopups?: Array<{ hotkey: Hotkey, Popup: React.ComponentType<{ onClose: () => void, onInsert: (command: LexicalCommand<unknown>, params: unknown[]) => void }> }>
}

type PromptEditorContentProps = PromptEditorProps & {
  availableNodes: WorkflowNode[]
}

const PromptEditorContent: FC<PromptEditorContentProps> = ({
  instanceId,
  nodeId,
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
  toolMetadata,
  onToolMetadataChange,
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
  agentBlock,
  isSupportFileVar,
  isSupportSandbox,
  disableToolBlocks,
  onEnter,
  shortcutPopups = [],
  availableNodes,
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
        withKlass: CustomTextNode,
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
      ...(isSupportSandbox ? [FileReferenceNode, ToolGroupBlockNode, ToolBlockNode] : []),
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
    } as EventPayload)
  }, [eventEmitter, contextBlock?.datasets])
  useEffect(() => {
    eventEmitter?.emit({
      type: UPDATE_HISTORY_EVENT_EMITTER,
      payload: historyBlock?.history,
    } as EventPayload)
  }, [eventEmitter, historyBlock?.history])

  const toolBlockContextValue = React.useMemo(() => {
    if (!onToolMetadataChange)
      return null
    return {
      metadata: toolMetadata,
      onMetadataChange: onToolMetadataChange,
      useModal: true,
      nodeId,
      nodesOutputVars: workflowVariableBlock?.variables,
      availableNodes,
    }
  }, [availableNodes, nodeId, onToolMetadataChange, toolMetadata, workflowVariableBlock?.variables])

  const filePreviewContextValue = React.useMemo(() => ({
    enabled: Boolean(isSupportSandbox),
  }), [isSupportSandbox])

  const sandboxPlaceHolder = React.useMemo(() => {
    if (!isSupportSandbox)
      return null
    const i18nKey = disableToolBlocks
      ? 'promptEditor.placeholderSandboxNoTools'
      : 'promptEditor.placeholderSandbox'
    const components = disableToolBlocks
      ? [
          <span
            key="slash"
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] bg-components-kbd-bg-gray px-1 text-text-tertiary system-kbd"
          />,
          <span
            key="insert"
            className="border-b border-dotted border-current"
          />,
        ]
      : [
          <span
            key="slash"
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] bg-components-kbd-bg-gray px-1 text-text-tertiary system-kbd"
          />,
          <span
            key="insert"
            className="border-b border-dotted border-current"
          />,
          <span
            key="at"
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] bg-components-kbd-bg-gray px-1 text-text-tertiary system-kbd"
          />,
          <span
            key="tools"
            className="border-b border-dotted border-current"
          />,
        ]
    return (
      <Trans
        i18nKey={i18nKey}
        ns="common"
        components={components}
      />
    )
  }, [disableToolBlocks, isSupportSandbox])

  const [floatingAnchorElem, setFloatingAnchorElem] = useState<HTMLDivElement | null>(null)

  const onRef = (floatingAnchorElement: HTMLDivElement | null) => {
    if (floatingAnchorElement !== null)
      setFloatingAnchorElem(floatingAnchorElement)
  }

  return (
    <LexicalComposer initialConfig={{ ...initialConfig, editable }}>
      <ToolBlockContextProvider value={toolBlockContextValue}>
        <FilePreviewContextProvider value={filePreviewContextValue}>
          <div
            className={cn('relative', wrapperClassName)}
            data-skill-editor-root={isSupportSandbox ? 'true' : undefined}
            ref={onRef}
          >
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
                  value={placeholder || sandboxPlaceHolder}
                  className={cn('truncate', placeholderClassName)}
                  compact={compact}
                />
              )}
              ErrorBoundary={LexicalErrorBoundary}
            />
            {shortcutPopups?.map(({ hotkey, Popup }, idx) => (
              <ShortcutsPopupPlugin key={idx} hotkey={hotkey}>
                {(closePortal, onInsert) => <Popup onClose={closePortal} onInsert={onInsert} />}
              </ShortcutsPopupPlugin>
            ))}
            <ComponentPickerBlock
              triggerString="/"
              contextBlock={contextBlock}
              historyBlock={historyBlock}
              queryBlock={queryBlock}
              requestURLBlock={requestURLBlock}
              variableBlock={variableBlock}
              externalToolBlock={externalToolBlock}
              workflowVariableBlock={workflowVariableBlock}
              currentBlock={currentBlock}
              errorMessageBlock={errorMessageBlock}
              lastRunBlock={lastRunBlock}
              isSupportFileVar={isSupportFileVar}
              isSupportSandbox={isSupportSandbox}
            />
            {!isSupportSandbox && (!agentBlock || agentBlock.show) && (
              <ComponentPickerBlock
                triggerString="@"
                contextBlock={contextBlock}
                historyBlock={historyBlock}
                queryBlock={queryBlock}
                variableBlock={variableBlock}
                externalToolBlock={externalToolBlock}
                workflowVariableBlock={workflowVariableBlock}
                currentBlock={currentBlock}
                errorMessageBlock={errorMessageBlock}
                lastRunBlock={lastRunBlock}
                agentBlock={agentBlock}
                isSupportFileVar={isSupportFileVar}
              />
            )}
            {isSupportSandbox && (
              <>
                <ToolBlock />
                <ToolGroupBlockReplacementBlock />
                <ToolBlockReplacementBlock />
                {editable && !disableToolBlocks && <ToolPickerBlock enableAutoDefault />}
              </>
            )}
            <ComponentPickerBlock
              triggerString="{"
              contextBlock={contextBlock}
              historyBlock={historyBlock}
              queryBlock={queryBlock}
              requestURLBlock={requestURLBlock}
              variableBlock={variableBlock}
              externalToolBlock={externalToolBlock}
              workflowVariableBlock={workflowVariableBlock}
              currentBlock={currentBlock}
              errorMessageBlock={errorMessageBlock}
              lastRunBlock={lastRunBlock}
              isSupportFileVar={isSupportFileVar}
              isSupportSandbox={isSupportSandbox}
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
              hitlInputBlock?.show && (
                <>
                  <HITLInputBlock {...hitlInputBlock} />
                  <HITLInputBlockReplacementBlock {...hitlInputBlock} />
                </>
              )
            }
            {isSupportSandbox && <FileReferenceReplacementBlock />}
            {
              currentBlock?.show && (
                <>
                  <CurrentBlock {...currentBlock} />
                  <CurrentBlockReplacementBlock {...currentBlock} />
                </>
              )
            }
            {
              requestURLBlock?.show && (
                <>
                  <RequestURLBlock {...requestURLBlock} />
                  <RequestURLBlockReplacementBlock {...requestURLBlock} />
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
            <ValueSyncPlugin value={value} />
            <OnChangePlugin onChange={handleEditorChange} />
            <EnterCommandPlugin onEnter={onEnter} />
            <OnBlurBlock onBlur={onBlur} onFocus={onFocus} />
            <UpdateBlock instanceId={instanceId} />
            <HistoryPlugin />
            {floatingAnchorElem && (
              <DraggableBlockPlugin anchorElem={floatingAnchorElem} />
            )}
            {/* <TreeView /> */}
          </div>
        </FilePreviewContextProvider>
      </ToolBlockContextProvider>
    </LexicalComposer>
  )
}

const PromptEditor: FC<PromptEditorProps> = (props) => {
  const workflowStore = React.useContext(WorkflowContext)
  const hooksStore = React.useContext(HooksStoreContext)
  const hasWorkflowContext = Boolean(workflowStore && hooksStore)

  if (!hasWorkflowContext) {
    return (
      <PromptEditorContent
        {...props}
        availableNodes={[]}
      />
    )
  }

  return (
    <WorkflowAvailableNodes
      nodeId={props.nodeId}
      isSupportSandbox={props.isSupportSandbox}
    >
      {availableNodes => (
        <PromptEditorContent
          {...props}
          availableNodes={availableNodes}
        />
      )}
    </WorkflowAvailableNodes>
  )
}

export default PromptEditor
