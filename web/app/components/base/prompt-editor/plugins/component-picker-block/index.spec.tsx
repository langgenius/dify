import type { EventEmitter } from 'ahooks/lib/useEventEmitter'
import type { LexicalEditor } from 'lexical'
import type {
  ContextBlockType,
  CurrentBlockType,
  ErrorMessageBlockType,
  LastRunBlockType,
  QueryBlockType,
  VariableBlockType,
  WorkflowVariableBlockType,
} from '../../types'
import type { NodeOutPutVar, Var } from '@/app/components/workflow/types'
import type { EventEmitterValue } from '@/context/event-emitter'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $setSelection,
  KEY_ESCAPE_COMMAND,
} from 'lexical'
import * as React from 'react'
import { GeneratorType } from '@/app/components/app/configuration/config/automatic/types'
import { VarType } from '@/app/components/workflow/types'
import { EventEmitterContextProvider, useEventEmitterContextContext } from '@/context/event-emitter'
import { INSERT_CONTEXT_BLOCK_COMMAND } from '../context-block'
import { INSERT_CURRENT_BLOCK_COMMAND } from '../current-block'
import { INSERT_ERROR_MESSAGE_BLOCK_COMMAND } from '../error-message-block'
import { INSERT_LAST_RUN_BLOCK_COMMAND } from '../last-run-block'
import { INSERT_VARIABLE_VALUE_BLOCK_COMMAND } from '../variable-block'
import { INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND } from '../workflow-variable-block'
import ComponentPicker from './index'

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

beforeAll(() => {
  Range.prototype.getClientRects = vi.fn(() => {
    const rectList = [mockDOMRect] as unknown as DOMRectList
    Object.defineProperty(rectList, 'length', { value: 1 })
    Object.defineProperty(rectList, 'item', { value: (index: number) => (index === 0 ? mockDOMRect : null) })
    return rectList
  })
  Range.prototype.getBoundingClientRect = vi.fn(() => mockDOMRect as DOMRect)
})

// ─── Typed factories (no `any` / `never`) ────────────────────────────────────

function makeContextBlock(overrides: Partial<ContextBlockType> = {}): ContextBlockType {
  return { show: true, selectable: true, ...overrides }
}

function makeQueryBlock(overrides: Partial<QueryBlockType> = {}): QueryBlockType {
  return { show: true, selectable: true, ...overrides }
}

function makeVariableBlock(overrides: Partial<VariableBlockType> = {}): VariableBlockType {
  return { show: true, variables: [], ...overrides }
}

function makeCurrentBlock(overrides: Partial<CurrentBlockType> = {}): CurrentBlockType {
  return { show: true, generatorType: GeneratorType.prompt, ...overrides }
}

function makeErrorMessageBlock(overrides: Partial<ErrorMessageBlockType> = {}): ErrorMessageBlockType {
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

type ReactFiber = {
  child: ReactFiber | null
  sibling: ReactFiber | null
  return: ReactFiber | null
  memoizedState?: unknown
}

type ReactHook = {
  memoizedState?: unknown
  next?: ReactHook | null
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
  currentBlock,
  errorMessageBlock,
  lastRunBlock,
  captures,
}) => {
  const initialConfig = React.useMemo(() => ({
    namespace: `component-picker-test-${Math.random().toString(16).slice(2)}`,
    onError: (e: Error) => {
      throw e
    },
  }), [])

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

async function waitForEventEmitter(captures: Captures): Promise<NonNullable<Captures['eventEmitter']>> {
  await waitFor(() => {
    expect(captures.eventEmitter).not.toBeNull()
  })
  return captures.eventEmitter as NonNullable<Captures['eventEmitter']>
}

async function setEditorText(editor: LexicalEditor, text: string, selectEnd: boolean): Promise<void> {
  await act(async () => {
    editor.update(() => {
      const root = $getRoot()
      root.clear()
      const paragraph = $createParagraphNode()
      const textNode = $createTextNode(text)
      paragraph.append(textNode)
      root.append(paragraph)
      if (selectEnd)
        textNode.selectEnd()
    })
  })
}

function readEditorText(editor: LexicalEditor): string {
  return editor.getEditorState().read(() => $getRoot().getTextContent())
}

function getReactFiberFromDom(dom: Element): ReactFiber | null {
  const key = Object.keys(dom).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'))
  if (!key)
    return null
  return (dom as unknown as Record<string, unknown>)[key] as ReactFiber
}

function findHookRefPointingToElement(root: ReactFiber, element: Element): { current: unknown } | null {
  const visit = (fiber: ReactFiber | null): { current: unknown } | null => {
    if (!fiber)
      return null

    let hook = fiber.memoizedState as ReactHook | null | undefined
    while (hook) {
      const state = hook.memoizedState
      if (state && typeof state === 'object' && 'current' in state) {
        const ref = state as { current: unknown }
        if (ref.current === element)
          return ref
      }
      hook = hook.next
    }

    return visit(fiber.child) || visit(fiber.sibling)
  }
  return visit(root)
}

async function flushNextTick(): Promise<void> {
  // Used to flush 0ms setTimeout work scheduled by renderMenu (refs.setReference guard).
  await act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ComponentPicker (component-picker-block/index.tsx)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('does not render a menu when there are no options and workflowVariableBlock is not shown (renderMenu returns null)', async () => {
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

  it('renders prompt options in a portal and removes the trigger TextNode when selecting a normal option (nodeToRemove && key truthy)', async () => {
    const user = userEvent.setup()

    const captures: Captures = { editor: null, eventEmitter: null }
    render((
      <MinimalEditor
        triggerString="{"
        contextBlock={makeContextBlock()}
        queryBlock={makeQueryBlock()}
        captures={captures}
      />
    ))
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

  it('does not remove the trigger when selecting an option with an empty key (nodeToRemove && key falsy)', async () => {
    const captures: Captures = { editor: null, eventEmitter: null }
    render((
      <MinimalEditor
        triggerString="{"
        variableBlock={makeVariableBlock({
          show: true,
          // Edge case: an empty variable name produces a MenuOption key of '' (falsy),
          // which drives the `nodeToRemove && selectedOption?.key` condition to false.
          variables: [{ name: 'empty', value: '' }],
        })}
        captures={captures}
      />
    ))
    const editor = await waitForEditor(captures)

    await setEditorText(editor, '{', true)

    // There is no accessible "option" role here (menu items are plain divs).
    // We locate menu items by `tabindex="-1"` inside the listbox.
    const listbox = await screen.findByRole('listbox', { name: /typeahead menu/i })
    const menuItems = Array.from(listbox.querySelectorAll('[tabindex="-1"]'))

    // Expect at least: (1) our empty variable option, (2) the "add variable" option.
    expect(menuItems.length).toBeGreaterThanOrEqual(2)
    expect(within(listbox).getByText('common.promptEditor.variable.modal.add')).toBeInTheDocument()

    fireEvent.click(menuItems[0] as HTMLElement)

    // Since the key is falsy, ComponentPicker should NOT call nodeToRemove.remove().
    // The trigger remains in editor content.
    await waitFor(() => {
      expect(readEditorText(editor)).toContain('{')
    })
  })

  it('subscribes to EventEmitter and dispatches INSERT_VARIABLE_VALUE_BLOCK_COMMAND only for matching messages', async () => {
    const captures: Captures = { editor: null, eventEmitter: null }
    render((
      <MinimalEditor
        triggerString="{"
        contextBlock={makeContextBlock()}
        captures={captures}
      />
    ))

    const editor = await waitForEditor(captures)
    const eventEmitter = await waitForEventEmitter(captures)
    const dispatchSpy = vi.spyOn(editor, 'dispatchCommand')

    // Non-object emissions (string) should be ignored by the subscription callback.
    eventEmitter.emit('some-string')
    expect(dispatchSpy).not.toHaveBeenCalledWith(INSERT_VARIABLE_VALUE_BLOCK_COMMAND, expect.any(String))

    // Mismatched type should be ignored.
    eventEmitter.emit({ type: 'OTHER', payload: 'x' })
    expect(dispatchSpy).not.toHaveBeenCalledWith(INSERT_VARIABLE_VALUE_BLOCK_COMMAND, '{{x}}')

    // Matching type should dispatch with {{payload}} wrapping.
    eventEmitter.emit({ type: INSERT_VARIABLE_VALUE_BLOCK_COMMAND as unknown as string, payload: 'foo' })
    expect(dispatchSpy).toHaveBeenCalledWith(INSERT_VARIABLE_VALUE_BLOCK_COMMAND, '{{foo}}')
  })

  it('handles workflow variable selection: flat vars (current/error_message/last_run) and closes on Escape from search input', async () => {
    const captures: Captures = { editor: null, eventEmitter: null }

    const workflowVariableBlock = makeWorkflowVariableBlock({}, [
      { nodeId: 'custom-flat', title: 'custom-flat', isFlat: true, vars: [makeWorkflowNodeVar('custom_flat', VarType.string)] },
      makeWorkflowVarNode('node-output', 'Node Output', [
        makeWorkflowNodeVar('output', VarType.string),
      ]),
    ])

    render((
      <MinimalEditor
        triggerString="{"
        workflowVariableBlock={workflowVariableBlock}
        currentBlock={makeCurrentBlock({ generatorType: GeneratorType.prompt })}
        errorMessageBlock={makeErrorMessageBlock()}
        lastRunBlock={makeLastRunBlock()}
        captures={captures}
      />
    ))

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

    // Re-open menu and select a flat var that is not handled by the special-case list.
    // This covers the "no-op" path in the `isFlat` branch.
    dispatchSpy.mockClear()
    await setEditorText(editor, '{', true)
    await flushNextTick()
    const customFlatLabel = await screen.findByText('custom_flat')
    await act(async () => {
      fireEvent.click(customFlatLabel)
    })
    await flushNextTick()
    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('handles workflow variable selection for nested fields: sys.query, sys.files, and normal paths', async () => {
    const captures: Captures = { editor: null, eventEmitter: null }
    const user = userEvent.setup()

    const workflowVariableBlock = makeWorkflowVariableBlock({}, [
      makeWorkflowVarNode('node-1', 'Node 1', [
        makeWorkflowNodeVar('sys.query', VarType.object, [makeWorkflowNodeVar('q', VarType.string)]),
        makeWorkflowNodeVar('sys.files', VarType.object, [makeWorkflowNodeVar('f', VarType.string)]),
        makeWorkflowNodeVar('output', VarType.object, [makeWorkflowNodeVar('x', VarType.string)]),
      ]),
    ])

    render((
      <MinimalEditor
        triggerString="{"
        workflowVariableBlock={workflowVariableBlock}
        captures={captures}
      />
    ))

    const editor = await waitForEditor(captures)
    const dispatchSpy = vi.spyOn(editor, 'dispatchCommand')

    const openPickerAndSelectField = async (variableTitle: string, fieldName: string) => {
      await setEditorText(editor, '{', true)
      await screen.findByPlaceholderText('workflow.common.searchVar')
      await act(async () => { /* flush effects */ })

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
    expect(dispatchSpy).toHaveBeenCalledWith(INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND, ['node-1', 'output', 'x'])
    await waitFor(() => expect(readEditorText(editor)).not.toContain('{'))
  })

  it('skips removing the trigger when selection is null (needRemove is null) and still dispatches', async () => {
    const captures: Captures = { editor: null, eventEmitter: null }

    const workflowVariableBlock = makeWorkflowVariableBlock({}, [
      { nodeId: 'current', title: 'current_prompt', isFlat: true, vars: [makeWorkflowNodeVar('current', VarType.string)] },
    ])

    render((
      <MinimalEditor
        triggerString="{"
        workflowVariableBlock={workflowVariableBlock}
        captures={captures}
      />
    ))

    const editor = await waitForEditor(captures)
    const dispatchSpy = vi.spyOn(editor, 'dispatchCommand')

    await setEditorText(editor, '{', true)
    const currentLabel = await screen.findByText('current_prompt')

    // Force selection to null and click within the same act() to avoid the typeahead UI unmounting
    // before the click handler fires.
    await act(async () => {
      editor.update(() => {
        $setSelection(null)
      })
      currentLabel.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(dispatchSpy).toHaveBeenCalledWith(INSERT_CURRENT_BLOCK_COMMAND, undefined)
    await waitFor(() => expect(readEditorText(editor)).toContain('{'))
  })

  it('covers the anchor-ref guard when anchorElementRef.current becomes null before the scheduled callback runs', async () => {
    // `@lexical/react` keeps `anchorElementRef.current` as a stable element reference, which means the
    // "anchor is null" path is hard to reach through normal interactions in JSDOM.
    //
    // To reach 100% branch coverage for `index.tsx`, we:
    // 1) Pause timers so the scheduled callback doesn't run immediately.
    // 2) Find the `useRef` hook object used by LexicalTypeaheadMenuPlugin that points at `#typeahead-menu`.
    // 3) Set that ref's `.current = null` before advancing timers.
    //
    // This avoids mocking third-party modules while still exercising the guard.
    vi.useFakeTimers()

    const captures: Captures = { editor: null, eventEmitter: null }
    render((
      <MinimalEditor
        triggerString="{"
        contextBlock={makeContextBlock()}
        captures={captures}
      />
    ))

    await act(async () => { /* flush effects */ })
    expect(captures.editor).not.toBeNull()
    const editor = captures.editor as LexicalEditor

    await setEditorText(editor, '{', true)
    const typeaheadMenu = document.getElementById('typeahead-menu')
    expect(typeaheadMenu).not.toBeNull()

    const ce = screen.getByTestId(CONTENT_EDITABLE_TEST_ID)
    const fiber = getReactFiberFromDom(ce)
    expect(fiber).not.toBeNull()
    const root = (() => {
      let cur = fiber as ReactFiber
      while (cur.return)
        cur = cur.return
      return cur
    })()

    const anchorRef = findHookRefPointingToElement(root, typeaheadMenu as Element)
    expect(anchorRef).not.toBeNull()
    anchorRef!.current = null

    await act(async () => {
      vi.runOnlyPendingTimers()
    })

    vi.useRealTimers()
  })

  it('renders the workflow-variable divider when workflowVariableBlock is shown and options are non-empty', async () => {
    const captures: Captures = { editor: null, eventEmitter: null }

    const workflowVariableBlock = makeWorkflowVariableBlock({}, [
      makeWorkflowVarNode('node-1', 'Node 1', [
        makeWorkflowNodeVar('output', VarType.string),
      ]),
    ])

    render((
      <MinimalEditor
        triggerString="{"
        workflowVariableBlock={workflowVariableBlock}
        contextBlock={makeContextBlock()}
        captures={captures}
      />
    ))

    const editor = await waitForEditor(captures)
    await setEditorText(editor, '{', true)

    // Both sections are present.
    expect(await screen.findByPlaceholderText('workflow.common.searchVar')).toBeInTheDocument()
    expect(await screen.findByText('common.promptEditor.context.item.title')).toBeInTheDocument()

    // With a single option group, the only divider should be the workflow-var/options separator.
    expect(document.querySelectorAll('.bg-divider-subtle')).toHaveLength(1)
  })
})
