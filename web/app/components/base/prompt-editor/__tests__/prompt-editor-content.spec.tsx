import type { EventEmitter } from 'ahooks/lib/useEventEmitter'
import type { LexicalEditor } from 'lexical'
import type { ComponentProps } from 'react'
import type { EventEmitterValue } from '@/context/event-emitter'
import { CodeNode } from '@lexical/code'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  BLUR_COMMAND,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  FOCUS_COMMAND,
  TextNode,
} from 'lexical'
import { useEffect } from 'react'
import { GeneratorType } from '@/app/components/app/configuration/config/automatic/types'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { ContextBlockNode } from '../plugins/context-block'
import { CurrentBlockNode } from '../plugins/current-block'
import { CustomTextNode } from '../plugins/custom-text/node'
import { ErrorMessageBlockNode } from '../plugins/error-message-block'
import { HistoryBlockNode } from '../plugins/history-block'
import { HITLInputNode } from '../plugins/hitl-input-block'
import { LastRunBlockNode } from '../plugins/last-run-block'
import { QueryBlockNode } from '../plugins/query-block'
import { RequestURLBlockNode } from '../plugins/request-url-block'
import { PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER } from '../plugins/update-block'
import { VariableValueBlockNode } from '../plugins/variable-value-block/node'
import { WorkflowVariableBlockNode } from '../plugins/workflow-variable-block'
import PromptEditorContent from '../prompt-editor-content'
import { textToEditorState } from '../utils'

type Captures = {
  editor: LexicalEditor | null
  eventEmitter: EventEmitter<EventEmitterValue> | null
}

const mockDOMRect = {
  x: 100,
  y: 100,
  width: 100,
  height: 20,
  top: 100,
  right: 200,
  bottom: 120,
  left: 100,
  toJSON: () => ({}),
}

const originalRangeGetClientRects = Range.prototype.getClientRects
const originalRangeGetBoundingClientRect = Range.prototype.getBoundingClientRect

const setSelectionOnEditable = (editable: HTMLElement) => {
  const lexicalTextNode = editable.querySelector('[data-lexical-text="true"]')?.firstChild
  const range = document.createRange()

  if (lexicalTextNode) {
    range.setStart(lexicalTextNode, 0)
    range.setEnd(lexicalTextNode, 1)
  }
  else {
    range.selectNodeContents(editable)
  }

  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

const CaptureEditorAndEmitter = ({ captures }: { captures: Captures }) => {
  const { eventEmitter } = useEventEmitterContextContext()
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    captures.editor = editor
  }, [captures, editor])

  useEffect(() => {
    captures.eventEmitter = eventEmitter
  }, [captures, eventEmitter])

  return null
}

const PromptEditorContentHarness = ({
  captures,
  initialText = '',
  ...props
}: ComponentProps<typeof PromptEditorContent> & { captures: Captures, initialText?: string }) => (
  <EventEmitterContextProvider>
    <LexicalComposer
      initialConfig={{
        namespace: 'prompt-editor-content-test',
        editable: true,
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
          LastRunBlockNode,
        ],
        editorState: textToEditorState(initialText),
        onError: (error: Error) => {
          throw error
        },
      }}
    >
      <CaptureEditorAndEmitter captures={captures} />
      <PromptEditorContent {...props} />
    </LexicalComposer>
  </EventEmitterContextProvider>
)

describe('PromptEditorContent', () => {
  beforeAll(() => {
    Range.prototype.getClientRects = vi.fn(() => {
      const rectList = [mockDOMRect] as unknown as DOMRectList
      Object.defineProperty(rectList, 'length', { value: 1 })
      Object.defineProperty(rectList, 'item', { value: (index: number) => index === 0 ? mockDOMRect : null })
      return rectList
    })
    Range.prototype.getBoundingClientRect = vi.fn(() => mockDOMRect as DOMRect)
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterAll(() => {
    Range.prototype.getClientRects = originalRangeGetClientRects
    Range.prototype.getBoundingClientRect = originalRangeGetBoundingClientRect
  })

  // The extracted content shell should run with the real Lexical stack and forward editor commands through its composed plugins.
  describe('Rendering', () => {
    it('should render with real dependencies and forward update/focus/blur events', async () => {
      const captures: Captures = { editor: null, eventEmitter: null }
      const onEditorChange = vi.fn()
      const onFocus = vi.fn()
      const onBlur = vi.fn()
      const anchorElem = document.createElement('div')

      const { container } = render(
        <PromptEditorContentHarness
          captures={captures}
          compact={true}
          className="editor-shell"
          placeholder="Type prompt"
          shortcutPopups={[]}
          instanceId="content-editor"
          floatingAnchorElem={anchorElem}
          onEditorChange={onEditorChange}
          onFocus={onFocus}
          onBlur={onBlur}
        />,
      )

      expect(screen.getByText('Type prompt')).toBeInTheDocument()

      const editable = container.querySelector('[contenteditable="true"]') as HTMLElement
      expect(editable.className).toContain('text-[13px]')

      await waitFor(() => {
        expect(captures.editor).not.toBeNull()
        expect(captures.eventEmitter).not.toBeNull()
      })

      act(() => {
        captures.eventEmitter?.emit({
          type: PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER,
          instanceId: 'content-editor',
          payload: 'updated prompt',
        })
      })

      await waitFor(() => {
        expect(onEditorChange).toHaveBeenCalled()
      })

      act(() => {
        captures.editor?.dispatchCommand(FOCUS_COMMAND, new FocusEvent('focus'))
        captures.editor?.dispatchCommand(BLUR_COMMAND, new FocusEvent('blur', { relatedTarget: null }))
      })

      expect(onFocus).toHaveBeenCalledTimes(1)
      expect(onBlur).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should render optional blocks and open shortcut popups with the real editor runtime', async () => {
      const captures: Captures = { editor: null, eventEmitter: null }
      const onEditorChange = vi.fn()
      const insertCommand = createCommand<string[]>('prompt-editor-shortcut-insert')
      const insertSpy = vi.fn()
      const Popup = ({ onClose, onInsert }: { onClose: () => void, onInsert: (command: typeof insertCommand, params: string[]) => void }) => (
        <>
          <button type="button" onClick={() => onInsert(insertCommand, ['from-shortcut'])}>Insert shortcut</button>
          <button type="button" onClick={onClose}>Close shortcut</button>
        </>
      )

      const { container } = render(
        <PromptEditorContentHarness
          captures={captures}
          shortcutPopups={[{ hotkey: 'ctrl+/', Popup }]}
          initialText="seed prompt"
          floatingAnchorElem={document.createElement('div')}
          onEditorChange={onEditorChange}
          contextBlock={{ show: true, datasets: [] }}
          queryBlock={{ show: true }}
          requestURLBlock={{ show: true }}
          historyBlock={{ show: true, history: { user: 'user-role', assistant: 'assistant-role' } }}
          variableBlock={{ show: true, variables: [] }}
          externalToolBlock={{ show: true, externalTools: [] }}
          workflowVariableBlock={{ show: true, variables: [] }}
          hitlInputBlock={{
            show: true,
            nodeId: 'node-1',
            onFormInputItemRemove: vi.fn(),
            onFormInputItemRename: vi.fn(),
          }}
          currentBlock={{ show: true, generatorType: GeneratorType.prompt }}
          errorMessageBlock={{ show: true }}
          lastRunBlock={{ show: true }}
          isSupportFileVar={true}
        />,
      )

      await waitFor(() => {
        expect(captures.editor).not.toBeNull()
      })

      const unregister = captures.editor?.registerCommand(
        insertCommand,
        (payload) => {
          insertSpy(payload)
          return true
        },
        COMMAND_PRIORITY_EDITOR,
      )

      const editable = container.querySelector('[contenteditable="true"]') as HTMLElement
      editable.focus()
      setSelectionOnEditable(editable)

      fireEvent.keyDown(document, { key: '/', ctrlKey: true })

      const insertButton = await screen.findByRole('button', { name: 'Insert shortcut' })
      fireEvent.click(insertButton)

      expect(insertSpy).toHaveBeenCalledWith(['from-shortcut'])
      expect(onEditorChange).toHaveBeenCalled()

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Insert shortcut' })).not.toBeInTheDocument()
      })

      unregister?.()
    })

    it('should keep the shell stable without optional anchor or placeholder overrides', async () => {
      const captures: Captures = { editor: null, eventEmitter: null }

      render(
        <PromptEditorContentHarness
          captures={captures}
          shortcutPopups={[]}
          floatingAnchorElem={null}
          onEditorChange={vi.fn()}
        />,
      )

      await waitFor(() => {
        expect(captures.editor).not.toBeNull()
      })

      expect(screen.queryByTestId('draggable-target-line')).not.toBeInTheDocument()
      expect(screen.getByText('common.promptEditor.placeholder')).toBeInTheDocument()
    })
  })
})
