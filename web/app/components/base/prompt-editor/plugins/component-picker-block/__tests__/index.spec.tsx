import type { EventEmitter } from 'ahooks/lib/useEventEmitter'
import type { LexicalEditor } from 'lexical'
import type {
  AgentOutputBlockType,
  ContextBlockType,
  CurrentBlockType,
  ErrorMessageBlockType,
  LastRunBlockType,
  QueryBlockType,
  VariableBlockType,
  WorkflowVariableBlockType,
} from '../../../types'
import type { NodeOutPutVar, Var } from '@/app/components/workflow/types'
import type { EventEmitterValue } from '@/context/event-emitter'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  BLUR_COMMAND,
  FOCUS_COMMAND,
  KEY_ESCAPE_COMMAND,
} from 'lexical'
import * as React from 'react'
import { GeneratorType } from '@/app/components/app/configuration/config/automatic/types'
import { VarType } from '@/app/components/workflow/types'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { INSERT_AGENT_OUTPUT_BLOCK_COMMAND } from '../../agent-output-block/commands'
import { INSERT_CONTEXT_BLOCK_COMMAND } from '../../context-block'
import { INSERT_CURRENT_BLOCK_COMMAND } from '../../current-block'
import { CustomTextNode } from '../../custom-text/node'
import { INSERT_ERROR_MESSAGE_BLOCK_COMMAND } from '../../error-message-block'
import { INSERT_LAST_RUN_BLOCK_COMMAND } from '../../last-run-block'
import { INSERT_VARIABLE_VALUE_BLOCK_COMMAND } from '../../variable-block'
import { INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND } from '../../workflow-variable-block'
import ComponentPicker from '../index'

// Mock Range.getClientRects / getBoundingClientRect for Lexical menu positioning in JSDOM.
// This mirrors the pattern used by other prompt-editor plugin tests in this repo.
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

const originalRangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
const originalRangeBounds = Object.getOwnPropertyDescriptor(
  Range.prototype,
  'getBoundingClientRect',
)

beforeAll(() => {
  Range.prototype.getClientRects = vi.fn(() => {
    const rectList = [mockDOMRect] as unknown as DOMRectList
    Object.defineProperty(rectList, 'length', { value: 1 })
    Object.defineProperty(rectList, 'item', {
      value: (index: number) => (index === 0 ? mockDOMRect : null),
    })
    return rectList
  })
  Range.prototype.getBoundingClientRect = vi.fn(() => mockDOMRect as DOMRect)
})

afterEach(() => vi.useRealTimers())

afterAll(() => {
  for (const [name, descriptor] of [
    ['getClientRects', originalRangeRects],
    ['getBoundingClientRect', originalRangeBounds],
  ] as const) {
    if (descriptor) Object.defineProperty(Range.prototype, name, descriptor)
    else Reflect.deleteProperty(Range.prototype, name)
  }
})

// ─── Typed factories (no `any` / `never`) ────────────────────────────────────

function makeContextBlock(overrides: Partial<ContextBlockType> = {}): ContextBlockType {
  return { show: true, selectable: true, ...overrides }
}

function makeQueryBlock(overrides: Partial<QueryBlockType> = {}): QueryBlockType {
  return { show: true, selectable: true, ...overrides }
}

function makeCurrentBlock(overrides: Partial<CurrentBlockType> = {}): CurrentBlockType {
  return { show: true, generatorType: GeneratorType.prompt, ...overrides }
}

function makeErrorMessageBlock(
  overrides: Partial<ErrorMessageBlockType> = {},
): ErrorMessageBlockType {
  return { show: true, ...overrides }
}

function makeLastRunBlock(overrides: Partial<LastRunBlockType> = {}): LastRunBlockType {
  return { show: true, ...overrides }
}

function makeWorkflowNodeVar(variable: string, type: VarType, children?: Var['children']): Var {
  return { variable, type, children }
}

function makeWorkflowVarNode(nodeId: string, title: string, vars: Var[]): NodeOutPutVar {
  return { nodeId, title, vars }
}

function makeWorkflowVariableBlock(
  overrides: Partial<WorkflowVariableBlockType> = {},
  variables: NodeOutPutVar[] = [],
): WorkflowVariableBlockType {
  return { show: true, variables, ...overrides }
}

// ─── Test harness ────────────────────────────────────────────────────────────

type Captures = {
  editor: LexicalEditor | null
  eventEmitter: EventEmitter<EventEmitterValue> | null
}

const CaptureEditorAndEmitter: React.FC<{ captures: Captures }> = ({ captures }) => {
  const [editor] = useLexicalComposerContext()
  const { eventEmitter } = useEventEmitterContextContext()

  React.useEffect(() => {
    captures.editor = editor
  }, [captures, editor])

  React.useEffect(() => {
    captures.eventEmitter = eventEmitter
  }, [captures, eventEmitter])

  return null
}

const CONTENT_EDITABLE_TEST_ID = 'component-picker-ce'

const MinimalEditor: React.FC<{
  triggerString: string
  contextBlock?: ContextBlockType
  queryBlock?: QueryBlockType
  variableBlock?: VariableBlockType
  workflowVariableBlock?: WorkflowVariableBlockType
  agentOutputBlock?: AgentOutputBlockType
  currentBlock?: CurrentBlockType
  errorMessageBlock?: ErrorMessageBlockType
  lastRunBlock?: LastRunBlockType
  captures: Captures
}> = ({
  triggerString,
  contextBlock,
  queryBlock,
  variableBlock,
  workflowVariableBlock,
  agentOutputBlock,
  currentBlock,
  errorMessageBlock,
  lastRunBlock,
  captures,
}) => {
  const initialConfig = React.useMemo(
    () => ({
      namespace: 'component-picker-test',
      nodes: [CustomTextNode],
      onError: (e: Error) => {
        throw e
      },
    }),
    [],
  )

  return (
    <EventEmitterContextProvider>
      <LexicalComposer initialConfig={initialConfig}>
        <RichTextPlugin
          contentEditable={<ContentEditable data-testid={CONTENT_EDITABLE_TEST_ID} />}
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />

        <CaptureEditorAndEmitter captures={captures} />

        <ComponentPicker
          triggerString={triggerString}
          contextBlock={contextBlock}
          queryBlock={queryBlock}
          variableBlock={variableBlock}
          workflowVariableBlock={workflowVariableBlock}
          agentOutputBlock={agentOutputBlock}
          currentBlock={currentBlock}
          errorMessageBlock={errorMessageBlock}
          lastRunBlock={lastRunBlock}
        />
      </LexicalComposer>
    </EventEmitterContextProvider>
  )
}

async function waitForEditor(captures: Captures): Promise<LexicalEditor> {
  await waitFor(() => {
    expect(captures.editor).not.toBeNull()
  })
  return captures.editor as LexicalEditor
}

async function waitForEventEmitter(
  captures: Captures,
): Promise<NonNullable<Captures['eventEmitter']>> {
  await waitFor(() => {
    expect(captures.eventEmitter).not.toBeNull()
  })
  return captures.eventEmitter as NonNullable<Captures['eventEmitter']>
}

async function setEditorText(
  editor: LexicalEditor,
  text: string,
  selectEnd: boolean,
): Promise<void> {
  await act(async () => {
    editor.update(() => {
      const root = $getRoot()
      root.clear()
      const paragraph = $createParagraphNode()
      const textNode = $createTextNode(text)
      paragraph.append(textNode)
      root.append(paragraph)
      if (selectEnd) textNode.selectEnd()
    })
  })
}

function readEditorText(editor: LexicalEditor): string {
  return editor.getEditorState().read(() => $getRoot().getTextContent())
}

async function flushNextTick(): Promise<void> {
  // Used to flush 0ms setTimeout work scheduled by renderMenu (refs.setReference guard).
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ComponentPicker (component-picker-block/index.tsx)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('does not render a menu when there are no options and workflowVariableBlock is not shown', async () => {
    const captures: Captures = { editor: null, eventEmitter: null }
    render(<MinimalEditor triggerString="{" captures={captures} />)

    const editor = await waitForEditor(captures)
    await setEditorText(editor, '{', true)

    // Menu should not appear because renderMenu exits early without an anchor + content.
    await waitFor(() => {
      expect(screen.queryByText('common.promptEditor.context.item.title')).not.toBeInTheDocument()
      expect(screen.queryByPlaceholderText('workflow.common.searchVar')).not.toBeInTheDocument()
    })
  })

  it.each(['{[', '[Open manual]({source_url})'])(
    'keeps the add-variable action usable after entering "%s"',
    async (text) => {
      const user = userEvent.setup()
      const captures: Captures = { editor: null, eventEmitter: null }
      render(
        <MinimalEditor
          triggerString="{"
          variableBlock={{ show: true, variables: [] }}
          captures={captures}
        />,
      )

      const editor = await waitForEditor(captures)
      await setEditorText(editor, text, true)

      const addVariable = await screen.findByRole('option', {
        name: 'common.promptEditor.variable.modal.add',
      })
      expect(readEditorText(editor)).toBe(text)
      await user.click(addVariable)

      await waitFor(() => expect(readEditorText(editor)).toContain('{{}}'))
    },
  )

  it('renders prompt options in a portal and removes the trigger TextNode when selecting a normal option', async () => {
    const user = userEvent.setup()

    const captures: Captures = { editor: null, eventEmitter: null }
    render(
      <MinimalEditor
        triggerString="{"
        contextBlock={makeContextBlock()}
        queryBlock={makeQueryBlock()}
        captures={captures}
      />,
    )
    const editor = await waitForEditor(captures)
    const dispatchSpy = vi.spyOn(editor, 'dispatchCommand')

    // Open the typeahead menu by inserting the trigger character at the caret.
    await setEditorText(editor, '{', true)

    // The i18n mock returns "common.<key>" for { ns: 'common' }.
    const contextTitle = await screen.findByText('common.promptEditor.context.item.title')
    expect(contextTitle).toBeInTheDocument()

    // Hover over another menu item to trigger `onSetHighlight` -> `setHighlightedIndex(index)`.
    const queryTitle = await screen.findByText('common.promptEditor.query.item.title')
    const queryItem = queryTitle.closest('[tabindex="-1"]')
    expect(queryItem).not.toBeNull()
    await user.hover(queryItem as HTMLElement)

    // Flush the 0ms timer in renderMenu that calls refs.setReference(anchor).
    await flushNextTick()

    fireEvent.click(contextTitle)

    // Selecting an option should dispatch a command (from the real option implementation).
    expect(dispatchSpy).toHaveBeenCalledWith(INSERT_CONTEXT_BLOCK_COMMAND, undefined)

    // The trigger character should be removed from editor content via `nodeToRemove.remove()`.
    await waitFor(() => {
      expect(readEditorText(editor)).not.toContain('{')
    })
  })

  it('subscribes to EventEmitter and dispatches INSERT_VARIABLE_VALUE_BLOCK_COMMAND only for matching messages', async () => {
    const captures: Captures = { editor: null, eventEmitter: null }
    render(
      <MinimalEditor triggerString="{" contextBlock={makeContextBlock()} captures={captures} />,
    )

    const editor = await waitForEditor(captures)
    const eventEmitter = await waitForEventEmitter(captures)
    const dispatchSpy = vi.spyOn(editor, 'dispatchCommand')

    // Non-object emissions (string) should be ignored by the subscription callback.
    eventEmitter.emit('some-string')
    expect(dispatchSpy).not.toHaveBeenCalledWith(
      INSERT_VARIABLE_VALUE_BLOCK_COMMAND,
      expect.any(String),
    )

    // Mismatched type should be ignored.
    eventEmitter.emit({ type: 'OTHER', payload: 'x' })
    expect(dispatchSpy).not.toHaveBeenCalledWith(INSERT_VARIABLE_VALUE_BLOCK_COMMAND, '{{x}}')

    // Matching type should dispatch with {{payload}} wrapping.
    eventEmitter.emit({
      type: INSERT_VARIABLE_VALUE_BLOCK_COMMAND as unknown as string,
      payload: 'foo',
    })
    expect(dispatchSpy).toHaveBeenCalledWith(INSERT_VARIABLE_VALUE_BLOCK_COMMAND, '{{foo}}')
  })

  it('handles workflow variable selection: flat vars (current/error_message/last_run) and closes on Escape from search input', async () => {
    const captures: Captures = { editor: null, eventEmitter: null }

    const workflowVariableBlock = makeWorkflowVariableBlock({}, [
      makeWorkflowVarNode('node-output', 'Node Output', [
        makeWorkflowNodeVar('output', VarType.string),
      ]),
    ])

    render(
      <MinimalEditor
        triggerString="{"
        workflowVariableBlock={workflowVariableBlock}
        currentBlock={makeCurrentBlock({ generatorType: GeneratorType.prompt })}
        errorMessageBlock={makeErrorMessageBlock()}
        lastRunBlock={makeLastRunBlock()}
        captures={captures}
      />,
    )

    const editor = await waitForEditor(captures)
    const dispatchSpy = vi.spyOn(editor, 'dispatchCommand')

    // Open menu and select current (flat).
    await setEditorText(editor, '{', true)
    await flushNextTick()
    const currentLabel = await screen.findByText('current_prompt')
    await act(async () => {
      fireEvent.click(currentLabel)
    })
    await flushNextTick()
    expect(dispatchSpy).toHaveBeenCalledWith(INSERT_CURRENT_BLOCK_COMMAND, GeneratorType.prompt)

    // Re-open menu and select error_message (flat).
    await setEditorText(editor, '{', true)
    await flushNextTick()
    const errorMessageLabel = await screen.findByText('error_message')
    await act(async () => {
      fireEvent.click(errorMessageLabel)
    })
    await flushNextTick()
    expect(dispatchSpy).toHaveBeenCalledWith(INSERT_ERROR_MESSAGE_BLOCK_COMMAND, null)

    // Re-open menu and select last_run (flat).
    await setEditorText(editor, '{', true)
    await flushNextTick()
    const lastRunLabel = await screen.findByText('last_run')
    await act(async () => {
      fireEvent.click(lastRunLabel)
    })
    await flushNextTick()
    expect(dispatchSpy).toHaveBeenCalledWith(INSERT_LAST_RUN_BLOCK_COMMAND, null)

    // Re-open menu and press Escape in the VarReferenceVars search input to exercise handleClose().
    await setEditorText(editor, '{', true)
    await flushNextTick()
    const searchInput = await screen.findByPlaceholderText('workflow.common.searchVar')
    await act(async () => {
      fireEvent.keyDown(searchInput, { key: 'Escape' })
    })
    await flushNextTick()
    expect(dispatchSpy).toHaveBeenCalledWith(KEY_ESCAPE_COMMAND, expect.any(KeyboardEvent))
    expect(screen.queryByPlaceholderText('workflow.common.searchVar')).not.toBeInTheDocument()
  })

  it('handles workflow variable selection for nested fields: sys.query, sys.files, and normal paths', async () => {
    const captures: Captures = { editor: null, eventEmitter: null }
    const user = userEvent.setup()

    const workflowVariableBlock = makeWorkflowVariableBlock({}, [
      makeWorkflowVarNode('node-1', 'Node 1', [
        makeWorkflowNodeVar('sys.query', VarType.object, [
          makeWorkflowNodeVar('q', VarType.string),
        ]),
        makeWorkflowNodeVar('sys.files', VarType.object, [
          makeWorkflowNodeVar('f', VarType.string),
        ]),
        makeWorkflowNodeVar('output', VarType.object, [makeWorkflowNodeVar('x', VarType.string)]),
      ]),
    ])

    render(
      <MinimalEditor
        triggerString="{"
        workflowVariableBlock={workflowVariableBlock}
        captures={captures}
      />,
    )

    const editor = await waitForEditor(captures)
    const dispatchSpy = vi.spyOn(editor, 'dispatchCommand')

    const openPickerAndSelectField = async (variableTitle: string, fieldName: string) => {
      await setEditorText(editor, '{', true)
      await screen.findByPlaceholderText('workflow.common.searchVar')
      await act(async () => {
        /* flush effects */
      })

      const label = document.querySelector(`[title="${variableTitle}"]`)
      expect(label).not.toBeNull()
      const row = (label as HTMLElement).parentElement?.parentElement
      expect(row).not.toBeNull()

      // `ahooks/useHover` listens for native `mouseenter` / `mouseleave`. `user.hover` triggers
      // a realistic event sequence that reliably hits those listeners in JSDOM.
      await user.hover(row as HTMLElement)
      const field = await screen.findByText(fieldName)
      fireEvent.mouseDown(field)
      await user.unhover(row as HTMLElement)
    }

    await openPickerAndSelectField('sys.query', 'q')
    expect(dispatchSpy).toHaveBeenCalledWith(INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND, ['sys.query'])
    await waitFor(() => expect(readEditorText(editor)).not.toContain('{'))

    await openPickerAndSelectField('sys.files', 'f')
    expect(dispatchSpy).toHaveBeenCalledWith(INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND, ['sys.files'])
    await waitFor(() => expect(readEditorText(editor)).not.toContain('{'))

    await openPickerAndSelectField('output', 'x')
    expect(dispatchSpy).toHaveBeenCalledWith(INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND, [
      'node-1',
      'output',
      'x',
    ])
    await waitFor(() => expect(readEditorText(editor)).not.toContain('{'))
  })

  it('filters workflow variables from slash input and matches child paths', async () => {
    const captures: Captures = { editor: null, eventEmitter: null }
    const user = userEvent.setup()

    const workflowVariableBlock = makeWorkflowVariableBlock({}, [
      makeWorkflowVarNode('node-1', 'Node 1', [
        makeWorkflowNodeVar('payload', VarType.object, [
          makeWorkflowNodeVar('child_name', VarType.string),
        ]),
        makeWorkflowNodeVar('other_value', VarType.string),
      ]),
    ])

    render(
      <MinimalEditor
        triggerString="/"
        contextBlock={makeContextBlock()}
        workflowVariableBlock={workflowVariableBlock}
        captures={captures}
      />,
    )

    const editor = await waitForEditor(captures)
    const dispatchSpy = vi.spyOn(editor, 'dispatchCommand')

    await setEditorText(editor, '/child', true)
    await flushNextTick()

    expect(screen.queryByPlaceholderText('workflow.common.searchVar')).not.toBeInTheDocument()
    expect(await screen.findByText('payload')).toBeInTheDocument()
    expect(screen.queryByText('other_value')).not.toBeInTheDocument()

    const label = document.querySelector('[title="payload"]')
    expect(label).not.toBeNull()
    const row = (label as HTMLElement).parentElement?.parentElement
    expect(row).not.toBeNull()

    await user.hover(row as HTMLElement)
    const childField = await screen.findByText('child_name')
    fireEvent.mouseDown(childField)
    await user.unhover(row as HTMLElement)

    expect(dispatchSpy).toHaveBeenCalledWith(INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND, [
      'node-1',
      'payload',
      'child_name',
    ])
    await waitFor(() => expect(readEditorText(editor)).not.toContain('/child'))
  })

  it('filters workflow variables on the first character after slash and does not highlight context by default', async () => {
    const captures: Captures = { editor: null, eventEmitter: null }

    const workflowVariableBlock = makeWorkflowVariableBlock({}, [
      makeWorkflowVarNode('node-1', 'Node 1', [
        makeWorkflowNodeVar('child_value', VarType.string),
        makeWorkflowNodeVar('other_value', VarType.string),
      ]),
    ])

    render(
      <MinimalEditor
        triggerString="/"
        contextBlock={makeContextBlock()}
        workflowVariableBlock={workflowVariableBlock}
        captures={captures}
      />,
    )

    const editor = await waitForEditor(captures)
    await setEditorText(editor, '/c', true)
    await flushNextTick()

    expect(await screen.findByText('child_value')).toBeInTheDocument()
    expect(screen.queryByText('other_value')).not.toBeInTheDocument()

    const dispatchSpy = vi.spyOn(editor, 'dispatchCommand')
    fireEvent.keyDown(screen.getByTestId(CONTENT_EDITABLE_TEST_ID), { key: 'Enter' })
    expect(dispatchSpy).toHaveBeenCalledWith(INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND, [
      'node-1',
      'child_value',
    ])
    expect(dispatchSpy).not.toHaveBeenCalledWith(INSERT_CONTEXT_BLOCK_COMMAND, undefined)
    await waitFor(() => expect(readEditorText(editor)).toBe(''))
  })

  it('clears slash trigger state after creating an agent output from the footer action', async () => {
    const captures: Captures = { editor: null, eventEmitter: null }

    render(
      <MinimalEditor
        triggerString="/"
        workflowVariableBlock={makeWorkflowVariableBlock({}, [
          makeWorkflowVarNode('node-1', 'Node 1', [makeWorkflowNodeVar('output', VarType.string)]),
        ])}
        agentOutputBlock={{
          show: true,
          outputs: [],
          onChange: vi.fn(),
        }}
        captures={captures}
      />,
    )

    const editor = await waitForEditor(captures)
    const dispatchSpy = vi.spyOn(editor, 'dispatchCommand')

    await setEditorText(editor, '/', true)
    await flushNextTick()

    const newOutputAction = await screen.findByText(
      'workflowAgent.nodes.agent.outputVars.newOutput',
    )
    fireEvent.click(newOutputAction)

    expect(dispatchSpy).toHaveBeenCalledWith(INSERT_AGENT_OUTPUT_BLOCK_COMMAND, undefined)
    await waitFor(() => {
      expect(readEditorText(editor)).not.toContain('/')
      expect(
        screen.queryByText('workflowAgent.nodes.agent.outputVars.newOutput'),
      ).not.toBeInTheDocument()
    })

    const editable = screen.getByTestId(CONTENT_EDITABLE_TEST_ID)
    fireEvent.focus(editable)

    await flushNextTick()
    expect(
      screen.queryByText('workflowAgent.nodes.agent.outputVars.newOutput'),
    ).not.toBeInTheDocument()
  })

  it('defaults to the first workflow variable and removes the full slash query when selecting by keyboard', async () => {
    const captures: Captures = { editor: null, eventEmitter: null }

    const workflowVariableBlock = makeWorkflowVariableBlock({}, [
      makeWorkflowVarNode('node-1', 'Node 1', [
        makeWorkflowNodeVar('first_value', VarType.string),
        makeWorkflowNodeVar('second_value', VarType.string),
      ]),
    ])

    render(
      <MinimalEditor
        triggerString="/"
        contextBlock={makeContextBlock()}
        workflowVariableBlock={workflowVariableBlock}
        captures={captures}
      />,
    )

    const editor = await waitForEditor(captures)
    const dispatchSpy = vi.spyOn(editor, 'dispatchCommand')

    await setEditorText(editor, '/e', true)
    await flushNextTick()

    const firstItem = screen.getByText('first_value').closest('[data-selected]')
    const secondItem = screen.getByText('second_value').closest('[data-selected]')

    expect(firstItem).toHaveAttribute('data-selected', 'true')
    expect(secondItem).toHaveAttribute('data-selected', 'false')

    fireEvent.keyDown(screen.getByTestId(CONTENT_EDITABLE_TEST_ID), { key: 'ArrowDown' })

    expect(firstItem).toHaveAttribute('data-selected', 'false')
    expect(secondItem).toHaveAttribute('data-selected', 'true')

    fireEvent.keyDown(screen.getByTestId(CONTENT_EDITABLE_TEST_ID), { key: 'Enter' })

    expect(dispatchSpy).toHaveBeenCalledWith(INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND, [
      'node-1',
      'second_value',
    ])
    await waitFor(() => expect(readEditorText(editor)).not.toContain('/e'))
  })

  describe('blur/focus menu visibility', () => {
    it('restores menu visibility when focus command is dispatched after blur-sm hides it', async () => {
      const captures: Captures = { editor: null, eventEmitter: null }

      render(
        <MinimalEditor triggerString="{" contextBlock={makeContextBlock()} captures={captures} />,
      )

      const editor = await waitForEditor(captures)
      await setEditorText(editor, '{', true)
      expect(await screen.findByText('common.promptEditor.context.item.title')).toBeInTheDocument()

      vi.useFakeTimers()

      act(() => {
        editor.dispatchCommand(
          BLUR_COMMAND,
          new FocusEvent('blur-sm', { relatedTarget: document.createElement('button') }),
        )
      })
      act(() => {
        vi.advanceTimersByTime(200)
      })

      expect(screen.queryByText('common.promptEditor.context.item.title')).not.toBeInTheDocument()

      act(() => {
        editor.dispatchCommand(FOCUS_COMMAND, new FocusEvent('focus'))
      })

      vi.useRealTimers()

      await setEditorText(editor, '{', true)
      await waitFor(() => {
        expect(screen.queryByText('common.promptEditor.context.item.title')).toBeInTheDocument()
      })
    })

    it('cancels the blur-sm timer when focus arrives before the 200ms timeout', async () => {
      const captures: Captures = { editor: null, eventEmitter: null }

      render(
        <MinimalEditor triggerString="{" contextBlock={makeContextBlock()} captures={captures} />,
      )

      const editor = await waitForEditor(captures)
      await setEditorText(editor, '{', true)
      expect(await screen.findByText('common.promptEditor.context.item.title')).toBeInTheDocument()

      vi.useFakeTimers()

      act(() => {
        editor.dispatchCommand(
          BLUR_COMMAND,
          new FocusEvent('blur-sm', { relatedTarget: document.createElement('button') }),
        )
      })

      act(() => {
        editor.dispatchCommand(FOCUS_COMMAND, new FocusEvent('focus'))
      })

      act(() => {
        vi.advanceTimersByTime(200)
      })

      expect(screen.queryByText('common.promptEditor.context.item.title')).toBeInTheDocument()

      vi.useRealTimers()
    })

    it('cancels a pending blur-sm timer when a subsequent blur-sm targets var-search-input', async () => {
      const captures: Captures = { editor: null, eventEmitter: null }

      render(
        <MinimalEditor
          triggerString="{"
          contextBlock={makeContextBlock()}
          workflowVariableBlock={makeWorkflowVariableBlock()}
          captures={captures}
        />,
      )

      const editor = await waitForEditor(captures)
      await setEditorText(editor, '{', true)
      expect(await screen.findByText('common.promptEditor.context.item.title')).toBeInTheDocument()

      vi.useFakeTimers()

      act(() => {
        editor.dispatchCommand(
          BLUR_COMMAND,
          new FocusEvent('blur-sm', { relatedTarget: document.createElement('button') }),
        )
      })

      const varInput = screen.getByPlaceholderText('workflow.common.searchVar')

      act(() => {
        editor.dispatchCommand(BLUR_COMMAND, new FocusEvent('blur-sm', { relatedTarget: varInput }))
      })

      act(() => {
        vi.advanceTimersByTime(200)
      })

      expect(screen.queryByText('common.promptEditor.context.item.title')).toBeInTheDocument()

      vi.useRealTimers()
    })

    it('does not hide the menu when focus moves into a variable child popup', async () => {
      const captures: Captures = { editor: null, eventEmitter: null }

      render(
        <MinimalEditor
          triggerString="/"
          workflowVariableBlock={makeWorkflowVariableBlock({}, [
            makeWorkflowVarNode('node-1', 'Node 1', [
              makeWorkflowNodeVar('payload', VarType.object, [
                makeWorkflowNodeVar('child', VarType.string),
              ]),
            ]),
          ])}
          captures={captures}
        />,
      )

      const editor = await waitForEditor(captures)
      await setEditorText(editor, '/', true)
      expect(await screen.findByText('payload')).toBeInTheDocument()

      const user = userEvent.setup()
      const label = screen.getByTitle('payload')
      await user.hover(label.parentElement!.parentElement!)
      const popupTarget = await screen.findByText('child')
      vi.useFakeTimers()

      act(() => {
        editor.dispatchCommand(
          BLUR_COMMAND,
          new FocusEvent('blur-sm', { relatedTarget: popupTarget }),
        )
      })

      act(() => {
        vi.advanceTimersByTime(200)
      })

      expect(screen.getByTitle('payload')).toBeInTheDocument()

      vi.useRealTimers()
    })
  })
})
