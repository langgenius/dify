import type { FocusEvent as ReactFocusEvent, ReactNode } from 'react'
import type { PromptEditorProps } from '../index'
import type { ContextBlockType, CurrentBlockType, ErrorMessageBlockType, ExternalToolBlockType, HistoryBlockType, HITLInputBlockType, LastRunBlockType, QueryBlockType, RequestURLBlockType, VariableBlockType, WorkflowVariableBlockType } from '../types'
import { render, screen, waitFor } from '@testing-library/react'
import { BLUR_COMMAND, FOCUS_COMMAND } from 'lexical'
import * as React from 'react'
import { GeneratorType } from '../../../app/configuration/config/automatic/types'
import {
  UPDATE_DATASETS_EVENT_EMITTER,
  UPDATE_HISTORY_EVENT_EMITTER,
} from '../constants'
import PromptEditor from '../index'

const mocks = vi.hoisted(() => {
  const commandHandlers = new Map<unknown, (payload: unknown) => boolean>()
  const subscriptions: Array<(payload: unknown) => void> = []
  const rootElement = document.createElement('div')

  return {
    emit: vi.fn(),
    rootLines: ['first line', 'second line'],
    commandHandlers,
    subscriptions,
    rootElement,
    lastInitialConfig: null as Record<string, unknown> | null,
    editor: {
      hasNodes: vi.fn(() => true),
      registerCommand: vi.fn((command: unknown, handler: (payload: unknown) => boolean, _priority?: number) => {
        commandHandlers.set(command, handler)
        return vi.fn()
      }),
      registerUpdateListener: vi.fn(() => vi.fn()),
      registerNodeTransform: vi.fn(() => vi.fn()),
      dispatchCommand: vi.fn(),
      getRootElement: vi.fn(() => rootElement),
      parseEditorState: vi.fn(() => ({ state: 'parsed' })),
      setEditorState: vi.fn(),
      focus: vi.fn(),
      update: vi.fn((fn: () => void) => fn()),
    },
  }
})

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      emit: mocks.emit,
      useSubscription: (cb: (payload: unknown) => void) => {
        mocks.subscriptions.push(cb)
      },
    },
  }),
}))

vi.mock('@lexical/code', () => ({
  CodeNode: class CodeNode { },
}))

vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [mocks.editor],
}))

vi.mock('lexical', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lexical')>()
  return {
    ...actual,
    $getRoot: () => ({
      getChildren: () => mocks.rootLines.map(line => ({
        getTextContent: () => line,
      })),
    }),
    TextNode: class TextNode {
      __text: string
      constructor(text = '') {
        this.__text = text
      }
    },
  }
})

vi.mock('@lexical/react/LexicalComposer', () => ({
  LexicalComposer: ({ initialConfig, children }: { initialConfig: Record<string, unknown>, children: ReactNode }) => {
    mocks.lastInitialConfig = initialConfig
    return <div data-testid="lexical-composer">{children}</div>
  },
}))

vi.mock('@lexical/react/LexicalContentEditable', () => ({
  ContentEditable: (props: React.HTMLAttributes<HTMLDivElement>) => <div data-testid="content-editable" {...props} />,
}))

vi.mock('@lexical/react/LexicalErrorBoundary', () => ({
  LexicalErrorBoundary: () => <div data-testid="lexical-error-boundary" />,
}))

vi.mock('@lexical/react/LexicalHistoryPlugin', () => ({
  HistoryPlugin: () => <div data-testid="history-plugin" />,
}))

vi.mock('@lexical/react/LexicalOnChangePlugin', () => ({
  OnChangePlugin: ({ onChange }: { onChange: (editorState: { read: (fn: () => void) => void }) => void }) => {
    React.useEffect(() => {
      onChange({
        read: (fn: () => void) => fn(),
      })
    }, [onChange])
    return <div data-testid="on-change-plugin" />
  },
}))

vi.mock('@lexical/react/LexicalRichTextPlugin', () => ({
  RichTextPlugin: ({ contentEditable, placeholder }: { contentEditable: ReactNode, placeholder: ReactNode }) => (
    <div data-testid="rich-text-plugin">
      {contentEditable}
      {placeholder}
    </div>
  ),
}))

vi.mock('@lexical/react/LexicalTypeaheadMenuPlugin', () => ({
  MenuOption: class MenuOption {
    key: string
    constructor(key: string) {
      this.key = key
    }
  },
  LexicalTypeaheadMenuPlugin: () => <div data-testid="typeahead-plugin" />,
}))

vi.mock('@lexical/react/LexicalDraggableBlockPlugin', () => ({
  DraggableBlockPlugin_EXPERIMENTAL: ({ menuComponent, targetLineComponent }: {
    menuComponent: ReactNode
    targetLineComponent: ReactNode
  }) => (
    <div data-testid="draggable-plugin">
      {menuComponent}
      {targetLineComponent}
    </div>
  ),
}))

// Mock all plugin sub-components with data-testid divs
vi.mock('../plugins/context-block', () => ({
  ContextBlock: ({ show, selectable, datasets }: Record<string, unknown>) => (
    <div data-testid="context-block" data-show={String(show)} data-selectable={String(selectable)} data-datasets={JSON.stringify(datasets)} />
  ),
  ContextBlockNode: class ContextBlockNode { },
  ContextBlockReplacementBlock: () => <div data-testid="context-block-replacement" />,
  INSERT_CONTEXT_BLOCK_COMMAND: 'INSERT_CONTEXT_BLOCK_COMMAND',
  DELETE_CONTEXT_BLOCK_COMMAND: 'DELETE_CONTEXT_BLOCK_COMMAND',
}))

vi.mock('../plugins/query-block', () => ({
  QueryBlock: () => <div data-testid="query-block" />,
  QueryBlockNode: class QueryBlockNode { },
  QueryBlockReplacementBlock: () => <div data-testid="query-block-replacement" />,
}))

vi.mock('../plugins/history-block', () => ({
  HistoryBlock: () => <div data-testid="history-block" />,
  HistoryBlockNode: class HistoryBlockNode { },
  HistoryBlockReplacementBlock: () => <div data-testid="history-block-replacement" />,
}))

vi.mock('../plugins/variable-block', () => ({
  default: () => <div data-testid="variable-block" />,
}))

vi.mock('../plugins/variable-value-block', () => ({
  default: () => <div data-testid="variable-value-block" />,
}))

vi.mock('../plugins/variable-value-block/node', () => ({
  VariableValueBlockNode: class VariableValueBlockNode { },
}))

vi.mock('../plugins/workflow-variable-block', () => ({
  WorkflowVariableBlock: () => <div data-testid="workflow-variable-block" />,
  WorkflowVariableBlockNode: class WorkflowVariableBlockNode { },
  WorkflowVariableBlockReplacementBlock: () => <div data-testid="workflow-variable-block-replacement" />,
}))

vi.mock('../plugins/hitl-input-block', () => ({
  HITLInputBlock: () => <div data-testid="hitl-input-block" />,
  HITLInputNode: class HITLInputNode { },
  HITLInputBlockReplacementBlock: () => <div data-testid="hitl-input-block-replacement" />,
}))

vi.mock('../plugins/current-block', () => ({
  CurrentBlock: () => <div data-testid="current-block" />,
  CurrentBlockNode: class CurrentBlockNode { },
  CurrentBlockReplacementBlock: () => <div data-testid="current-block-replacement" />,
}))

vi.mock('../plugins/request-url-block', () => ({
  RequestURLBlock: () => <div data-testid="request-url-block" />,
  RequestURLBlockNode: class RequestURLBlockNode { },
  RequestURLBlockReplacementBlock: () => <div data-testid="request-url-block-replacement" />,
}))

vi.mock('../plugins/error-message-block', () => ({
  ErrorMessageBlock: () => <div data-testid="error-message-block" />,
  ErrorMessageBlockNode: class ErrorMessageBlockNode { },
  ErrorMessageBlockReplacementBlock: () => <div data-testid="error-message-block-replacement" />,
}))

vi.mock('../plugins/last-run-block', () => ({
  LastRunBlock: () => <div data-testid="last-run-block" />,
  LastRunBlockNode: class LastRunBlockNode { },
  LastRunReplacementBlock: () => <div data-testid="last-run-replacement-block" />,
}))

vi.mock('../plugins/on-blur-or-focus-block', () => ({
  default: ({ onBlur, onFocus }: { onBlur?: () => void, onFocus?: () => void }) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    React.useEffect(() => {
      const unregFocus = mocks.editor.registerCommand(
        FOCUS_COMMAND,
        () => {
          onFocus?.()
          return false
        },
        1,
      )
      const unregBlur = mocks.editor.registerCommand(
        BLUR_COMMAND,
        () => {
          onBlur?.()
          return false
        },
        1,
      )
      return () => {
        unregFocus()
        unregBlur()
      }
    }, [onBlur, onFocus])
    return <div data-testid="on-blur-block" />
  },
}))

vi.mock('../plugins/placeholder', () => ({
  default: ({ value, className, compact }: { value?: string | ReactNode, className?: string, compact?: boolean }) => (
    <div data-testid="placeholder" className={className} data-compact={compact}>
      {value}
    </div>
  ),
}))

vi.mock('../plugins/update-block', () => ({
  default: ({ instanceId }: { instanceId?: string }) => <div data-testid="update-block" data-instance-id={instanceId} />,
}))

vi.mock('../plugins/component-picker-block', () => ({
  default: ({ triggerString }: { triggerString: string }) => <div data-testid={`component-picker-${triggerString}`} />,
}))

vi.mock('../plugins/draggable-plugin', () => ({
  default: () => <div data-testid="draggable-block-plugin" />,
}))

vi.mock('../plugins/shortcuts-popup-plugin', () => ({
  default: ({ children, hotkey }: { children: (close: () => void, onInsert: () => void) => ReactNode, hotkey: string[] | string }) => (
    <div data-testid="shortcuts-popup-plugin" data-hotkey={JSON.stringify(hotkey)}>
      {typeof children === 'function' ? children(() => { }, () => { }) : children}
    </div>
  ),
  SHORTCUTS_EMPTY_CONTENT: 'shortcuts_empty_content',
}))

vi.mock('../plugins/custom-text/node', () => ({
  CustomTextNode: class CustomTextNode {
    __text: string
    constructor(text = '') {
      this.__text = text
    }
  },
}))

vi.mock('../utils', () => ({
  textToEditorState: vi.fn((text: string) => `editor-state:${text}`),
  registerLexicalTextEntity: vi.fn(() => []),
}))

vi.mock('@/utils/classnames', () => ({
  cn: (...args: (string | boolean | undefined | null)[]) => args.filter(Boolean).join(' '),
}))

// Extract Popup components to top-level to satisfy react/no-unstable-nested-components lint rule
const TestPopup: NonNullable<PromptEditorProps['shortcutPopups']>[number]['Popup'] = ({ onClose }) => (
  <button type="button" onClick={onClose}>close</button>
)

const TestPopup1: NonNullable<PromptEditorProps['shortcutPopups']>[number]['Popup'] = ({ onClose }) => (
  <button type="button" onClick={onClose}>popup1</button>
)

const TestPopup2: NonNullable<PromptEditorProps['shortcutPopups']>[number]['Popup'] = ({ onClose }) => (
  <button type="button" onClick={onClose}>popup2</button>
)

const FullRenderingPopup: NonNullable<PromptEditorProps['shortcutPopups']>[number]['Popup'] = ({ onClose }) => (
  <button type="button" onClick={onClose}>popup</button>
)

describe('PromptEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.commandHandlers.clear()
    mocks.subscriptions.length = 0
    mocks.rootLines = ['first line', 'second line']
  })

  // Rendering shell and text output from lexical state.
  describe('Rendering', () => {
    it('should render placeholder and call onChange with joined lexical text', async () => {
      const onChange = vi.fn()

      render(
        <PromptEditor
          compact={true}
          className="editor-class"
          placeholder="Type prompt"
          value="seed-value"
          onChange={onChange}
        />,
      )

      expect(screen.getByTestId('placeholder')).toHaveTextContent('Type prompt')
      expect(screen.getByTestId('content-editable')).toHaveClass('editor-class')
      expect(screen.getByTestId('content-editable')).toHaveClass('text-[13px]')

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith('first line\nsecond line')
      })
    })

    it('should render with compact=false (default text size)', () => {
      render(
        <PromptEditor
          compact={false}
          placeholder="Type prompt"
        />,
      )

      const contentEditable = screen.getByTestId('content-editable')
      expect(contentEditable).toHaveClass('text-sm')
      expect(contentEditable).toHaveClass('leading-6')
    })

    it('should render with style prop applied to ContentEditable', () => {
      render(
        <PromptEditor
          style={{ color: 'red', fontSize: '14px' }}
        />,
      )

      const contentEditable = screen.getByTestId('content-editable')
      expect(contentEditable.style.color).toBe('red')
      expect(contentEditable.style.fontSize).toBe('14px')
    })

    it('should render with wrapperClassName', () => {
      render(
        <PromptEditor
          wrapperClassName="custom-wrapper"
        />,
      )

      expect(screen.getByTestId('lexical-composer')).toBeInTheDocument()
    })

    it('should render with placeholderClassName', () => {
      render(
        <PromptEditor
          placeholder="Type prompt"
          placeholderClassName="custom-placeholder"
        />,
      )

      const placeholder = screen.getByTestId('placeholder')
      expect(placeholder).toHaveClass('custom-placeholder')
    })

    it('should render with ReactNode placeholder', () => {
      render(
        <PromptEditor
          placeholder={<span data-testid="custom-placeholder">Custom Placeholder</span>}
        />,
      )

      expect(screen.getByTestId('custom-placeholder')).toBeInTheDocument()
    })

    it('should render with editable=false', () => {
      render(
        <PromptEditor
          editable={false}
        />,
      )

      expect(screen.getByTestId('lexical-composer')).toBeInTheDocument()
    })

    it('should render with instanceId', () => {
      render(
        <PromptEditor
          instanceId="unique-editor-id"
        />,
      )

      expect(screen.getByTestId('lexical-composer')).toBeInTheDocument()
    })

    it('should render with empty value', () => {
      render(
        <PromptEditor
          value=""
        />,
      )

      expect(screen.getByTestId('lexical-composer')).toBeInTheDocument()
    })

    it('should render without onChange callback (no error)', () => {
      render(
        <PromptEditor
          value="test value"
        />,
      )

      expect(screen.getByTestId('lexical-composer')).toBeInTheDocument()
    })

    it('should render default style when style prop is undefined', () => {
      render(
        <PromptEditor />,
      )

      expect(screen.getByTestId('content-editable')).toBeInTheDocument()
    })
  })

  // Event emitter integration for datasets and history updates.
  describe('Event Emission', () => {
    it('should emit dataset and history updates when corresponding props change', () => {
      const contextBlock: ContextBlockType = {
        show: false,
        datasets: [{ id: 'ds-1', name: 'Dataset One', type: 'dataset' }],
      }
      const historyBlock: HistoryBlockType = {
        show: false,
        history: { user: 'user-role', assistant: 'assistant-role' },
      }

      const { rerender } = render(
        <PromptEditor
          contextBlock={contextBlock}
          historyBlock={historyBlock}
        />,
      )

      expect(mocks.emit).toHaveBeenCalledWith({
        type: UPDATE_DATASETS_EVENT_EMITTER,
        payload: [{ id: 'ds-1', name: 'Dataset One', type: 'dataset' }],
      })
      expect(mocks.emit).toHaveBeenCalledWith({
        type: UPDATE_HISTORY_EVENT_EMITTER,
        payload: { user: 'user-role', assistant: 'assistant-role' },
      })

      rerender(
        <PromptEditor
          contextBlock={{
            show: false,
            datasets: [{ id: 'ds-2', name: 'Dataset Two', type: 'dataset' }],
          }}
          historyBlock={{
            show: false,
            history: { user: 'user-next', assistant: 'assistant-next' },
          }}
        />,
      )

      expect(mocks.emit).toHaveBeenCalledWith({
        type: UPDATE_DATASETS_EVENT_EMITTER,
        payload: [{ id: 'ds-2', name: 'Dataset Two', type: 'dataset' }],
      })
      expect(mocks.emit).toHaveBeenCalledWith({
        type: UPDATE_HISTORY_EVENT_EMITTER,
        payload: { user: 'user-next', assistant: 'assistant-next' },
      })
    })

    it('should emit with undefined datasets when contextBlock has no datasets', () => {
      render(
        <PromptEditor
          contextBlock={{ show: false }}
        />,
      )

      expect(mocks.emit).toHaveBeenCalledWith({
        type: UPDATE_DATASETS_EVENT_EMITTER,
        payload: undefined,
      })
    })

    it('should emit with undefined history when historyBlock has no history', () => {
      render(
        <PromptEditor
          historyBlock={{ show: false }}
        />,
      )

      expect(mocks.emit).toHaveBeenCalledWith({
        type: UPDATE_HISTORY_EVENT_EMITTER,
        payload: undefined,
      })
    })
  })

  // OnBlurBlock command callbacks should forward to PromptEditor handlers.
  describe('Focus/Blur Callbacks', () => {
    it('should call onFocus and onBlur when lexical focus/blur commands fire', () => {
      const onFocus = vi.fn()
      const onBlur = vi.fn()

      render(
        <PromptEditor
          onFocus={onFocus}
          onBlur={onBlur}
        />,
      )

      const focusHandler = mocks.commandHandlers.get(FOCUS_COMMAND)
      const blurHandler = mocks.commandHandlers.get(BLUR_COMMAND)

      expect(focusHandler).toBeDefined()
      expect(blurHandler).toBeDefined()

      focusHandler?.(undefined)
      blurHandler?.({ relatedTarget: null } as ReactFocusEvent<Element>)

      expect(onFocus).toHaveBeenCalledTimes(1)
      expect(onBlur).toHaveBeenCalledTimes(1)
    })
  })

  // Props typing guard for shortcut popup shape without any-casts.
  describe('Shortcut Popups', () => {
    it('should accept typed shortcut popup configuration', () => {
      render(
        <PromptEditor
          shortcutPopups={[{
            hotkey: ['mod', '/'],
            Popup: TestPopup,
          }]}
        />,
      )

      expect(screen.getByTestId('lexical-composer')).toBeInTheDocument()
    })

    it('should render ShortcutsPopupPlugin for each entry in shortcutPopups', () => {
      render(
        <PromptEditor
          shortcutPopups={[
            { hotkey: ['mod', '/'], Popup: TestPopup1 },
            { hotkey: 'ctrl+k', Popup: TestPopup2 },
          ]}
        />,
      )

      const plugins = screen.getAllByTestId('shortcuts-popup-plugin')
      expect(plugins).toHaveLength(2)
      expect(screen.getByText('popup1')).toBeInTheDocument()
      expect(screen.getByText('popup2')).toBeInTheDocument()
    })

    it('should handle empty shortcutPopups array', () => {
      render(
        <PromptEditor
          shortcutPopups={[]}
        />,
      )

      expect(screen.queryByTestId('shortcuts-popup-plugin')).not.toBeInTheDocument()
    })

    it('should handle undefined shortcutPopups', () => {
      render(
        <PromptEditor
          shortcutPopups={undefined}
        />,
      )

      expect(screen.queryByTestId('shortcuts-popup-plugin')).not.toBeInTheDocument()
    })
  })

  // Component picker blocks with two trigger strings.
  describe('Component Picker Blocks', () => {
    it('should render two ComponentPickerBlock instances with / and { triggers', () => {
      render(
        <PromptEditor />,
      )

      expect(screen.getByTestId('component-picker-/')).toBeInTheDocument()
      expect(screen.getByTestId('component-picker-{')).toBeInTheDocument()
    })
  })

  // Block rendering with show=true.
  describe('Block Rendering (show=true)', () => {
    it('should render contextBlock when show is true', () => {
      const contextBlock: ContextBlockType = {
        show: true,
        datasets: [{ id: 'ds-1', name: 'Dataset', type: 'dataset' }],
        selectable: true,
      }

      render(
        <PromptEditor contextBlock={contextBlock} />,
      )

      expect(screen.getByTestId('context-block')).toBeInTheDocument()
      expect(screen.getByTestId('context-block-replacement')).toBeInTheDocument()
    })

    it('should render queryBlock when show is true', () => {
      const queryBlock: QueryBlockType = {
        show: true,
        selectable: true,
      }

      render(
        <PromptEditor queryBlock={queryBlock} />,
      )

      expect(screen.getByTestId('query-block')).toBeInTheDocument()
      expect(screen.getByTestId('query-block-replacement')).toBeInTheDocument()
    })

    it('should render historyBlock when show is true', () => {
      const historyBlock: HistoryBlockType = {
        show: true,
        history: { user: 'User', assistant: 'Assistant' },
      }

      render(
        <PromptEditor historyBlock={historyBlock} />,
      )

      expect(screen.getByTestId('history-block')).toBeInTheDocument()
      expect(screen.getByTestId('history-block-replacement')).toBeInTheDocument()
    })

    it('should render variableBlock and variableValueBlock when variableBlock.show is true', () => {
      const variableBlock: VariableBlockType = {
        show: true,
        variables: [{ value: 'v1', name: 'Var 1' }],
      }

      render(
        <PromptEditor variableBlock={variableBlock} />,
      )

      expect(screen.getByTestId('variable-block')).toBeInTheDocument()
      expect(screen.getByTestId('variable-value-block')).toBeInTheDocument()
    })

    it('should render variableBlock and variableValueBlock when externalToolBlock.show is true', () => {
      const externalToolBlock: ExternalToolBlockType = {
        show: true,
        externalTools: [{ name: 'Tool', variableName: 'tool1' }],
      }

      render(
        <PromptEditor externalToolBlock={externalToolBlock} />,
      )

      expect(screen.getByTestId('variable-block')).toBeInTheDocument()
      expect(screen.getByTestId('variable-value-block')).toBeInTheDocument()
    })

    it('should render workflowVariableBlock when show is true', () => {
      const workflowVariableBlock: WorkflowVariableBlockType = {
        show: true,
        variables: [],
      }

      render(
        <PromptEditor workflowVariableBlock={workflowVariableBlock} />,
      )

      expect(screen.getByTestId('workflow-variable-block')).toBeInTheDocument()
      expect(screen.getByTestId('workflow-variable-block-replacement')).toBeInTheDocument()
    })

    it('should render hitlInputBlock when show is true', () => {
      const hitlInputBlock: HITLInputBlockType = {
        show: true,
        nodeId: 'node-1',
        onFormInputItemRemove: vi.fn(),
        onFormInputItemRename: vi.fn(),
      }

      render(
        <PromptEditor hitlInputBlock={hitlInputBlock} />,
      )

      expect(screen.getByTestId('hitl-input-block')).toBeInTheDocument()
      expect(screen.getByTestId('hitl-input-block-replacement')).toBeInTheDocument()
    })

    it('should render currentBlock when show is true', () => {
      const currentBlock: CurrentBlockType = {
        show: true,
        generatorType: GeneratorType.prompt,
      }

      render(
        <PromptEditor currentBlock={currentBlock} />,
      )

      expect(screen.getByTestId('current-block')).toBeInTheDocument()
      expect(screen.getByTestId('current-block-replacement')).toBeInTheDocument()
    })

    it('should render requestURLBlock when show is true', () => {
      const requestURLBlock: RequestURLBlockType = {
        show: true,
        selectable: true,
      }

      render(
        <PromptEditor requestURLBlock={requestURLBlock} />,
      )

      expect(screen.getByTestId('request-url-block')).toBeInTheDocument()
      expect(screen.getByTestId('request-url-block-replacement')).toBeInTheDocument()
    })

    it('should render errorMessageBlock when show is true', () => {
      const errorMessageBlock: ErrorMessageBlockType = {
        show: true,
      }

      render(
        <PromptEditor errorMessageBlock={errorMessageBlock} />,
      )

      expect(screen.getByTestId('error-message-block')).toBeInTheDocument()
      expect(screen.getByTestId('error-message-block-replacement')).toBeInTheDocument()
    })

    it('should render lastRunBlock when show is true', () => {
      const lastRunBlock: LastRunBlockType = {
        show: true,
      }

      render(
        <PromptEditor lastRunBlock={lastRunBlock} />,
      )

      expect(screen.getByTestId('last-run-block')).toBeInTheDocument()
      expect(screen.getByTestId('last-run-replacement-block')).toBeInTheDocument()
    })
  })

  // Block rendering with show=false.
  describe('Block Rendering (show=false)', () => {
    it('should not render contextBlock when show is false', () => {
      render(
        <PromptEditor contextBlock={{ show: false }} />,
      )

      expect(screen.queryByTestId('context-block')).not.toBeInTheDocument()
    })

    it('should not render queryBlock when show is false', () => {
      render(
        <PromptEditor queryBlock={{ show: false }} />,
      )

      expect(screen.queryByTestId('query-block')).not.toBeInTheDocument()
    })

    it('should not render historyBlock when show is false', () => {
      render(
        <PromptEditor historyBlock={{ show: false }} />,
      )

      expect(screen.queryByTestId('history-block')).not.toBeInTheDocument()
    })

    it('should not render variableBlock when show is false', () => {
      render(
        <PromptEditor variableBlock={{ show: false }} />,
      )

      expect(screen.queryByTestId('variable-block')).not.toBeInTheDocument()
    })

    it('should not render workflowVariableBlock when show is false', () => {
      render(
        <PromptEditor workflowVariableBlock={{ show: false }} />,
      )

      expect(screen.queryByTestId('workflow-variable-block')).not.toBeInTheDocument()
    })
  })

  // isSupportFileVar branch.
  describe('isSupportFileVar', () => {
    it('should render extra VariableValueBlock when isSupportFileVar is true', () => {
      render(
        <PromptEditor isSupportFileVar={true} />,
      )

      const blocks = screen.getAllByTestId('variable-value-block')
      expect(blocks.length).toBeGreaterThanOrEqual(1)
    })

    it('should not render extra VariableValueBlock when isSupportFileVar is false', () => {
      render(
        <PromptEditor isSupportFileVar={false} />,
      )

      expect(screen.queryByTestId('variable-value-block')).not.toBeInTheDocument()
    })
  })

  // DraggableBlockPlugin / onRef / floatingAnchorElem.
  describe('DraggableBlockPlugin', () => {
    it('should render DraggableBlockPlugin when floatingAnchorElem is set via onRef', () => {
      render(
        <PromptEditor />,
      )

      expect(screen.getByTestId('draggable-block-plugin')).toBeInTheDocument()
    })
  })

  // Comprehensive rendering with all blocks show=true.
  describe('Full Rendering', () => {
    it('should render all blocks simultaneously when all show=true', () => {
      render(
        <PromptEditor
          compact={true}
          className="full-class"
          placeholder="Full editor"
          value="hello"
          editable={true}
          instanceId="inst-1"
          contextBlock={{ show: true, datasets: [] }}
          queryBlock={{ show: true }}
          historyBlock={{ show: true, history: { user: 'u', assistant: 'a' } }}
          variableBlock={{ show: true, variables: [] }}
          externalToolBlock={{ show: true, externalTools: [] }}
          workflowVariableBlock={{ show: true, variables: [] }}
          hitlInputBlock={{ show: true, nodeId: 'n1', onFormInputItemRemove: vi.fn(), onFormInputItemRename: vi.fn() }}
          currentBlock={{ show: true, generatorType: GeneratorType.prompt }}
          requestURLBlock={{ show: true }}
          errorMessageBlock={{ show: true }}
          lastRunBlock={{ show: true }}
          isSupportFileVar={true}
          shortcutPopups={[{
            hotkey: ['mod', '/'],
            Popup: FullRenderingPopup,
          }]}
        />,
      )

      expect(screen.getByTestId('context-block')).toBeInTheDocument()
      expect(screen.getByTestId('query-block')).toBeInTheDocument()
      expect(screen.getByTestId('history-block')).toBeInTheDocument()
      expect(screen.getByTestId('variable-block')).toBeInTheDocument()
      expect(screen.getByTestId('workflow-variable-block')).toBeInTheDocument()
      expect(screen.getByTestId('hitl-input-block')).toBeInTheDocument()
      expect(screen.getByTestId('current-block')).toBeInTheDocument()
      expect(screen.getByTestId('request-url-block')).toBeInTheDocument()
      expect(screen.getByTestId('error-message-block')).toBeInTheDocument()
      expect(screen.getByTestId('last-run-block')).toBeInTheDocument()
      expect(screen.getByTestId('shortcuts-popup-plugin')).toBeInTheDocument()
      expect(screen.getByTestId('draggable-block-plugin')).toBeInTheDocument()
      expect(screen.getByTestId('on-change-plugin')).toBeInTheDocument()
      expect(screen.getByTestId('history-plugin')).toBeInTheDocument()
    })
  })

  // Test initialConfig callbacks (onError, with).
  describe('Initial Config', () => {
    it('should re-throw errors via onError', () => {
      render(<PromptEditor />)

      const config = mocks.lastInitialConfig
      expect(config).not.toBeNull()
      const onError = config!.onError as (error: Error) => void
      expect(() => onError(new Error('test error'))).toThrow('test error')
    })

    it('should create CustomTextNode via the with function in nodes config', () => {
      render(<PromptEditor value="hello" />)

      const config = mocks.lastInitialConfig
      expect(config).not.toBeNull()
      const nodes = config!.nodes as Array<{ replace?: unknown, with?: (node: { __text: string }) => unknown } | unknown>
      const replaceEntry = nodes.find(
        (n): n is { replace: unknown, with: (node: { __text: string }) => unknown } =>
          typeof n === 'object' && n !== null && 'replace' in n && 'with' in n,
      )
      expect(replaceEntry).toBeDefined()
      const result = replaceEntry!.with({ __text: 'hello world' })
      expect(result).toBeDefined()
      expect((result as { __text: string }).__text).toBe('hello world')
    })

    it('should pass correct namespace and editorState', () => {
      render(<PromptEditor value="test-value" />)

      const config = mocks.lastInitialConfig
      expect(config).not.toBeNull()
      expect(config!.namespace).toBe('prompt-editor')
      expect(config!.editorState).toBe('editor-state:test-value')
    })

    it('should use empty string when value is undefined', () => {
      render(<PromptEditor />)

      const config = mocks.lastInitialConfig
      expect(config).not.toBeNull()
      expect(config!.editorState).toBe('editor-state:')
    })
  })
})
