import type { FocusEvent as ReactFocusEvent, ReactNode } from 'react'
import type { PromptEditorProps } from '../index'
import type { ContextBlockType, HistoryBlockType } from '../types'
import { render, screen, waitFor } from '@testing-library/react'
import { BLUR_COMMAND, FOCUS_COMMAND } from 'lexical'
import * as React from 'react'
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
    editor: {
      hasNodes: vi.fn(() => true),
      registerCommand: vi.fn((command: unknown, handler: (payload: unknown) => boolean) => {
        commandHandlers.set(command, handler)
        return vi.fn()
      }),
      registerUpdateListener: vi.fn(() => vi.fn()),
      registerNodeTransform: vi.fn(() => vi.fn()),
      dispatchCommand: vi.fn(),
      getRootElement: vi.fn(() => rootElement),
      getEditorState: vi.fn(() => ({
        read: (fn: () => boolean) => fn(),
      })),
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
      getAllTextNodes: () => [],
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
  LexicalComposer: ({ initialConfig, children }: {
    initialConfig: {
      onError?: (error: Error) => void
      nodes?: Array<{ replace?: unknown, with: (arg: { __text: string }) => void }>
    }
    children: ReactNode
  }) => {
    if (initialConfig?.onError) {
      try {
        initialConfig.onError(new Error('test error'))
      }
      catch (e) {
        // ignore error
        console.error(e)
      }
    }
    if (initialConfig?.nodes) {
      const textNodeConf = initialConfig.nodes.find((n: { replace?: unknown, with: (arg: { __text: string }) => void }) => n?.replace)
      if (textNodeConf)
        textNodeConf.with({ __text: 'test' })
    }
    return <div data-testid="lexical-composer">{children}</div>
  },
}))

vi.mock('../plugins/shortcuts-popup-plugin', () => ({
  default: ({ children }: { children: (closePortal: () => void, onInsert: () => void) => ReactNode }) => (
    <div data-testid="shortcuts-popup-plugin">{children(vi.fn(), vi.fn())}</div>
  ),
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

      expect(screen.getByText('Type prompt')).toBeInTheDocument()
      expect(screen.getByTestId('content-editable')).toHaveClass('editor-class')
      expect(screen.getByTestId('content-editable')).toHaveClass('text-[13px]')

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith('first line\nsecond line')
      })
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

  // Prop typing guard for shortcut popup shape without any-casts.
  describe('Props Typing', () => {
    it('should accept typed shortcut popup configuration', () => {
      const Popup: NonNullable<PromptEditorProps['shortcutPopups']>[number]['Popup'] = ({ onClose }) => (
        <button type="button" onClick={onClose}>close</button>
      )

      render(
        <PromptEditor
          shortcutPopups={[{
            hotkey: ['mod', '/'],
            Popup,
          }]}
        />,
      )

      expect(screen.getByTestId('lexical-composer')).toBeInTheDocument()
    })

    it('should render multiple shortcutPopups', () => {
      const PopupA: NonNullable<PromptEditorProps['shortcutPopups']>[number]['Popup'] = ({ onClose }) => (
        <button data-testid="popup-a" onClick={onClose}>A</button>
      )
      const PopupB: NonNullable<PromptEditorProps['shortcutPopups']>[number]['Popup'] = ({ onClose }) => (
        <button data-testid="popup-b" onClick={onClose}>B</button>
      )

      render(
        <PromptEditor
          shortcutPopups={[
            { hotkey: 'ctrl+a', Popup: PopupA },
            { hotkey: 'ctrl+b', Popup: PopupB },
          ]}
        />,
      )

      expect(screen.getByTestId('lexical-composer')).toBeInTheDocument()
    })

    it('should render without onChange and not crash', () => {
      expect(() =>
        render(<PromptEditor compact={false} placeholder="Empty" />),
      ).not.toThrow()
    })

    it('should render with editable=false', () => {
      render(<PromptEditor editable={false} placeholder="read only" />)
      expect(screen.getByTestId('lexical-composer')).toBeInTheDocument()
    })

    it('should render with isSupportFileVar=true', () => {
      render(<PromptEditor isSupportFileVar={true} />)
      expect(screen.getByTestId('lexical-composer')).toBeInTheDocument()
    })

    it('should render all block types when show=true', () => {
      render(
        <PromptEditor
          contextBlock={{ show: true, datasets: [] }}
          queryBlock={{ show: true }}
          historyBlock={{ show: true, history: { user: 'u', assistant: 'a' } }}
          variableBlock={{ show: true }}
          workflowVariableBlock={{ show: true }}
          currentBlock={{ show: true, generatorType: 'summarize' as unknown as import('../types').CurrentBlockType['generatorType'] }}
          requestURLBlock={{ show: true }}
          errorMessageBlock={{ show: true }}
          lastRunBlock={{ show: true }}
        />,
      )
      expect(screen.getByTestId('lexical-composer')).toBeInTheDocument()
    })

    it('should render externalToolBlock when variableBlock is not shown', () => {
      render(
        <PromptEditor
          variableBlock={{ show: false }}
          externalToolBlock={{ show: true }}
        />,
      )
      expect(screen.getByTestId('lexical-composer')).toBeInTheDocument()
    })

    it('should unmount component to cover onRef cleanup', () => {
      const { unmount } = render(<PromptEditor />)
      expect(() => unmount()).not.toThrow()
    })

    it('should rerender without ref-driven update loops', () => {
      const { rerender } = render(<PromptEditor value="first" />)

      expect(() => {
        rerender(<PromptEditor value="second" />)
      }).not.toThrow()
    })

    it('should render hitl block when show=true', () => {
      render(
        <PromptEditor
          hitlInputBlock={{
            show: true,
            nodeId: 'node-1',
            onFormInputItemRemove: vi.fn(),
            onFormInputItemRename: vi.fn(),
          }}
        />,
      )
      expect(screen.getByTestId('lexical-composer')).toBeInTheDocument()
    })
  })
})
