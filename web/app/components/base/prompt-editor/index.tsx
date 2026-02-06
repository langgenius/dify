'use client'

import type {
  EditorState,
} from 'lexical'
import type { FC } from 'react'
import type {
  AgentBlockType,
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
import type { Node } from '@/app/components/workflow/types'
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
import { useEffect } from 'react'
import { Trans } from 'react-i18next'
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
  historyBlock?: HistoryBlockType
  variableBlock?: VariableBlockType
  externalToolBlock?: ExternalToolBlockType
  workflowVariableBlock?: WorkflowVariableBlockType
  currentBlock?: CurrentBlockType
  errorMessageBlock?: ErrorMessageBlockType
  lastRunBlock?: LastRunBlockType
  agentBlock?: AgentBlockType
  isSupportFileVar?: boolean
  isSupportSandbox?: boolean
  disableToolBlocks?: boolean
  onEnter?: (event: KeyboardEvent) => void
}

const PromptEditor: FC<PromptEditorProps> = ({
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
  historyBlock,
  variableBlock,
  externalToolBlock,
  workflowVariableBlock,
  currentBlock,
  errorMessageBlock,
  lastRunBlock,
  agentBlock,
  isSupportFileVar,
  isSupportSandbox,
  disableToolBlocks,
  onEnter,
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
      WorkflowVariableBlockNode,
      VariableValueBlockNode,
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

  const availableNodes = React.useMemo<Node[] | undefined>(() => {
    if (!workflowVariableBlock?.workflowNodesMap)
      return undefined
    return Object.entries(workflowVariableBlock.workflowNodesMap).map(([id, data]) => ({
      id,
      data: {
        title: data.title,
        type: data.type,
      } as any,
      position: data.position ?? { x: 0, y: 0 },
      width: data.width,
      height: data.height,
    })) as Node[]
  }, [workflowVariableBlock?.workflowNodesMap])

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
            className="system-kbd inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] bg-components-kbd-bg-gray px-1 text-text-tertiary"
          />,
          <span
            key="insert"
            className="border-b border-dotted border-current"
          />,
        ]
      : [
          <span
            key="slash"
            className="system-kbd inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] bg-components-kbd-bg-gray px-1 text-text-tertiary"
          />,
          <span
            key="insert"
            className="border-b border-dotted border-current"
          />,
          <span
            key="at"
            className="system-kbd inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] bg-components-kbd-bg-gray px-1 text-text-tertiary"
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

  return (
    <LexicalComposer initialConfig={{ ...initialConfig, editable }}>
      <ToolBlockContextProvider value={toolBlockContextValue}>
        <FilePreviewContextProvider value={{ enabled: Boolean(isSupportSandbox) }}>
          <div
            className={cn('relative', wrapperClassName)}
            data-skill-editor-root={isSupportSandbox ? 'true' : undefined}
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
            {/* <TreeView /> */}
          </div>
        </FilePreviewContextProvider>
      </ToolBlockContextProvider>
    </LexicalComposer>
  )
}

export default PromptEditor
