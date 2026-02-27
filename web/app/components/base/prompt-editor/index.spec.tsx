import type { FocusEvent as ReactFocusEvent, ReactNode } from 'react'
import type { PromptEditorProps } from './index'
import type { ContextBlockType, HistoryBlockType } from './types'
import { render, screen, waitFor } from '@testing-library/react'
import { BLUR_COMMAND, FOCUS_COMMAND } from 'lexical'
import * as React from 'react'
import {
  UPDATE_DATASETS_EVENT_EMITTER,
  UPDATE_HISTORY_EVENT_EMITTER,
} from './constants'
import PromptEditor from './index'

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
  CodeNode: class CodeNode {},
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
  LexicalComposer: ({ children }: { children: ReactNode }) => (
    <div data-testid="lexical-composer">{children}</div>
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
  })
})
