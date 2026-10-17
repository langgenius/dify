import type { Hotkey } from '@tanstack/react-hotkeys'
import type { ShortcutPopupDisplayMode, ShortcutPopupInsertHandler } from '../index'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { detectPlatform } from '@tanstack/react-hotkeys'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
} from 'lexical'
import * as React from 'react'
import { useEffect, useState } from 'react'
import ShortcutsPopupPlugin, { SHORTCUTS_EMPTY_CONTENT } from '../index'
import '@testing-library/jest-dom'

// Mock Range.getClientRects and getBoundingClientRect for JSDOM
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

beforeAll(() => {
  // Mock getClientRects on Range prototype
  Range.prototype.getClientRects = vi.fn(() => {
    const rectList = [mockDOMRect] as unknown as DOMRectList
    Object.defineProperty(rectList, 'length', { value: 1 })
    Object.defineProperty(rectList, 'item', {
      value: (index: number) => (index === 0 ? mockDOMRect : null),
    })
    return rectList
  })

  // Mock getBoundingClientRect on Range prototype
  Range.prototype.getBoundingClientRect = vi.fn(() => mockDOMRect as DOMRect)
})

afterAll(() => {
  Range.prototype.getClientRects = originalRangeGetClientRects
  Range.prototype.getBoundingClientRect = originalRangeGetBoundingClientRect
})

const CONTAINER_ID = 'host'
const CONTENT_EDITABLE_ID = 'ce'

const INSERT_TEXT = createCommand<string[]>('INSERT_TEST_TEXT')
const InsertTextPlugin = () => {
  const [editor] = useLexicalComposerContext()
  useEffect(
    () =>
      editor.registerCommand(
        INSERT_TEXT,
        (parts) => {
          $getRoot().append($createParagraphNode().append($createTextNode(parts.join(' '))))
          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    [editor],
  )
  return null
}

type MinimalEditorProps = {
  withContainer?: boolean
  hotkey?: Hotkey
  displayMode?: ShortcutPopupDisplayMode
  children?:
    | React.ReactNode
    | ((close: () => void, onInsert: ShortcutPopupInsertHandler) => React.ReactNode)
  className?: string
  onOpen?: () => void
  onClose?: () => void
}

const MinimalEditor: React.FC<MinimalEditorProps> = ({
  withContainer = true,
  hotkey,
  displayMode,
  children,
  className,
  onOpen,
  onClose,
}) => {
  const initialConfig = {
    namespace: 'shortcuts-popup-plugin-test',
    onError: (e: Error) => {
      throw e
    },
  }
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null)

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <InsertTextPlugin />
      <div
        data-testid={CONTAINER_ID}
        className="relative"
        ref={withContainer ? setContainerEl : undefined}
      >
        <RichTextPlugin
          contentEditable={<ContentEditable data-testid={CONTENT_EDITABLE_ID} />}
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <ShortcutsPopupPlugin
          container={withContainer ? containerEl : undefined}
          hotkey={hotkey}
          displayMode={displayMode}
          className={className}
          onOpen={onOpen}
          onClose={onClose}
        >
          {children}
        </ShortcutsPopupPlugin>
      </div>
    </LexicalComposer>
  )
}

/** Helper: focus the content editable and trigger a hotkey. */
function focusAndTriggerHotkey(
  key: string,
  modifiers: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {
    ...(detectPlatform() === 'mac' ? { metaKey: true } : { ctrlKey: true }),
  },
) {
  const ce = screen.getByTestId(CONTENT_EDITABLE_ID)
  ce.focus()
  fireEvent.keyDown(screen.getByTestId(CONTENT_EDITABLE_ID), { key, ...modifiers })
}

describe('ShortcutsPopupPlugin', () => {
  afterEach(() => vi.restoreAllMocks())

  it('opens with its configured shortcut and closes with Escape once per transition', async () => {
    const onOpen = vi.fn()
    const onClose = vi.fn()
    render(<MinimalEditor hotkey="Mod+K" onOpen={onOpen} onClose={onClose} />)
    expect(screen.queryByText(SHORTCUTS_EMPTY_CONTENT)).not.toBeInTheDocument()
    focusAndTriggerHotkey('/')
    expect(screen.queryByText(SHORTCUTS_EMPTY_CONTENT)).not.toBeInTheDocument()
    focusAndTriggerHotkey('k')
    expect(await screen.findByText(SHORTCUTS_EMPTY_CONTENT)).toBeInTheDocument()
    expect(onOpen).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByTestId(CONTENT_EDITABLE_ID), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText(SHORTCUTS_EMPTY_CONTENT)).not.toBeInTheDocument())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not open when editor is not focused', async () => {
    render(<MinimalEditor />)
    fireEvent.keyDown(screen.getByTestId(CONTENT_EDITABLE_ID), {
      key: '/',
      ...(detectPlatform() === 'mac' ? { metaKey: true } : { ctrlKey: true }),
    })
    await waitFor(() => {
      expect(screen.queryByText(SHORTCUTS_EMPTY_CONTENT)).not.toBeInTheDocument()
    })
  })

  it('closes on click outside', async () => {
    render(<MinimalEditor />)
    const ce = screen.getByTestId(CONTENT_EDITABLE_ID)
    ce.focus()

    fireEvent.keyDown(screen.getByTestId(CONTENT_EDITABLE_ID), {
      key: '/',
      ...(detectPlatform() === 'mac' ? { metaKey: true } : { ctrlKey: true }),
    })
    expect(await screen.findByText(SHORTCUTS_EMPTY_CONTENT)).toBeInTheDocument()

    fireEvent.mouseDown(ce)
    await waitFor(() => {
      expect(screen.queryByText(SHORTCUTS_EMPTY_CONTENT)).not.toBeInTheDocument()
    })
  })

  it('does not close on mousedown inside a Base UI portal overlay', async () => {
    render(<MinimalEditor />)
    const ce = screen.getByTestId(CONTENT_EDITABLE_ID)
    ce.focus()

    fireEvent.keyDown(screen.getByTestId(CONTENT_EDITABLE_ID), {
      key: '/',
      ...(detectPlatform() === 'mac' ? { metaKey: true } : { ctrlKey: true }),
    })
    expect(await screen.findByText(SHORTCUTS_EMPTY_CONTENT)).toBeInTheDocument()

    const portal = document.createElement('div')
    portal.setAttribute('data-base-ui-portal', '')
    const portalChild = document.createElement('button')
    portalChild.textContent = 'portal-child'
    portal.appendChild(portalChild)
    document.body.appendChild(portal)

    fireEvent.mouseDown(portalChild)

    await waitFor(() => {
      expect(screen.getByText(SHORTCUTS_EMPTY_CONTENT)).toBeInTheDocument()
    })

    portal.remove()
  })

  it('portals into provided container when container is set', async () => {
    render(<MinimalEditor withContainer />)
    const host = screen.getByTestId(CONTAINER_ID)
    focusAndTriggerHotkey('/')
    const portalContent = await screen.findByText(SHORTCUTS_EMPTY_CONTENT)
    const floatingDiv = screen.getByTestId('shortcuts-popup')
    expect(host).toContainElement(portalContent)
    expect(floatingDiv).toHaveStyle({ position: 'absolute' })
  })

  it('falls back to document.body when container is not provided', async () => {
    render(<MinimalEditor withContainer={false} />)
    focusAndTriggerHotkey('/')
    const portalContent = await screen.findByText(SHORTCUTS_EMPTY_CONTENT)
    const floatingDiv = screen.getByTestId('shortcuts-popup')
    expect(document.body).toContainElement(portalContent)
    expect(floatingDiv).toHaveStyle({ position: 'fixed' })
    expect(floatingDiv).toHaveStyle({ overflow: 'visible' })
  })

  it('can render fixed next to the workflow panel instead of following the cursor', async () => {
    const originalInnerWidth = window.innerWidth
    const originalInnerHeight = window.innerHeight
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })

    const rightPanel = document.createElement('div')
    rightPanel.setAttribute('data-workflow-right-panel', '')
    rightPanel.getBoundingClientRect = vi.fn(
      () =>
        ({
          x: 800,
          y: 56,
          width: 400,
          height: 840,
          top: 56,
          right: 1200,
          bottom: 896,
          left: 800,
          toJSON: () => ({}),
        }) as DOMRect,
    )
    document.body.appendChild(rightPanel)

    try {
      render(<MinimalEditor withContainer={false} displayMode="workflow-panel-adjacent-center" />)
      focusAndTriggerHotkey('/')
      await screen.findByText(SHORTCUTS_EMPTY_CONTENT)

      const floatingDiv = screen.getByTestId('shortcuts-popup')
      await waitFor(() => {
        expect(floatingDiv).toHaveStyle({
          position: 'fixed',
          right: '404px',
          top: '474px',
          transform: 'translateY(-50%)',
        })
      })
      expect(floatingDiv.style.getPropertyValue('--shortcut-popup-max-width')).toBe('400px')
      expect(floatingDiv.style.getPropertyValue('--shortcut-popup-max-height')).toBe('836px')
    } finally {
      rightPanel.remove()
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: originalInnerHeight,
      })
    }
  })

  it('does not open for an extra modifier or composing input', () => {
    render(<MinimalEditor />)
    const editor = screen.getByTestId(CONTENT_EDITABLE_ID)
    editor.focus()
    const modifier = detectPlatform() === 'mac' ? { metaKey: true } : { ctrlKey: true }
    fireEvent.keyDown(editor, { key: '/', ...modifier, altKey: true })
    fireEvent.keyDown(editor, { key: '/', ...modifier, isComposing: true })
    expect(screen.queryByText(SHORTCUTS_EMPTY_CONTENT)).not.toBeInTheDocument()
  })

  it('closes only from its editor or popup, leaving unrelated Escape alone', async () => {
    render(
      <MinimalEditor displayMode="workflow-panel-adjacent-center">
        <button type="button">Popup action</button>
      </MinimalEditor>,
    )
    focusAndTriggerHotkey('/')
    const popupAction = await screen.findByRole('button', { name: 'Popup action' })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(popupAction).toBeInTheDocument()
    fireEvent.keyDown(popupAction, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'Popup action' })).not.toBeInTheDocument()
  })

  it('calls close after insert via children render function', async () => {
    render(
      <MinimalEditor displayMode="workflow-panel-adjacent-center">
        {(_close: () => void, onInsert: ShortcutPopupInsertHandler) => (
          <div>
            <button
              type="button"
              data-testid="insert-btn"
              onClick={() => onInsert(INSERT_TEXT, ['inserted', 'text'])}
            >
              Insert
            </button>
          </div>
        )}
      </MinimalEditor>,
    )
    focusAndTriggerHotkey('/')

    const insertBtn = await screen.findByTestId('insert-btn')
    await userEvent.setup().click(insertBtn)
    await waitFor(() =>
      expect(screen.getByTestId(CONTENT_EDITABLE_ID)).toHaveTextContent('inserted text'),
    )

    // After insert, the popup should close
    await waitFor(() => {
      expect(screen.queryByTestId('insert-btn')).not.toBeInTheDocument()
    })
  })

  it('calls close via children render function close callback', async () => {
    render(
      <MinimalEditor displayMode="workflow-panel-adjacent-center">
        {(close: () => void) => (
          <button type="button" data-testid="close-via-fn" onClick={close}>
            Close
          </button>
        )}
      </MinimalEditor>,
    )
    focusAndTriggerHotkey('/')

    const closeBtn = await screen.findByTestId('close-via-fn')
    await userEvent.setup().click(closeBtn)

    await waitFor(() => {
      expect(screen.queryByTestId('close-via-fn')).not.toBeInTheDocument()
    })
  })

  it('does not close on mousedown inside the portal', async () => {
    render(
      <MinimalEditor>
        <div data-testid="portal-inner">Inner content</div>
      </MinimalEditor>,
    )
    focusAndTriggerHotkey('/')

    const inner = await screen.findByTestId('portal-inner')
    fireEvent.mouseDown(inner)

    // Should still be open
    await waitFor(() => {
      expect(screen.getByTestId('portal-inner')).toBeInTheDocument()
    })
  })

  it('prevents default and stops propagation on Escape when open', async () => {
    render(<MinimalEditor />)
    focusAndTriggerHotkey('/')
    await screen.findByText(SHORTCUTS_EMPTY_CONTENT)

    const parentKeyDown = vi.fn()
    const host = screen.getByTestId(CONTAINER_ID)
    host.addEventListener('keydown', parentKeyDown)

    // Use a custom event to capture preventDefault/stopPropagation calls
    const escEvent = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      screen.getByTestId(CONTENT_EDITABLE_ID).dispatchEvent(escEvent)
    })

    await waitFor(() => {
      expect(screen.queryByText(SHORTCUTS_EMPTY_CONTENT)).not.toBeInTheDocument()
    })
    expect(escEvent.defaultPrevented).toBe(true)
    expect(parentKeyDown).not.toHaveBeenCalled()
  })

  it('opens via lastSelectionRef fallback when getSelection returns no ranges', async () => {
    // First, focus and type so lastSelectionRef is populated
    render(<MinimalEditor />)
    focusAndTriggerHotkey('/')
    // First open works normally
    expect(await screen.findByText(SHORTCUTS_EMPTY_CONTENT)).toBeInTheDocument()
    // Close it
    fireEvent.keyDown(screen.getByTestId(CONTENT_EDITABLE_ID), { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByText(SHORTCUTS_EMPTY_CONTENT)).not.toBeInTheDocument()
    })

    // Now stub getSelection to return no ranges so lastSelectionRef is used
    const getSelection = vi
      .spyOn(window, 'getSelection')
      .mockReturnValue({ rangeCount: 0 } as Selection)

    focusAndTriggerHotkey('/')
    expect(await screen.findByText(SHORTCUTS_EMPTY_CONTENT)).toBeInTheDocument()

    getSelection.mockRestore()
  })
})
