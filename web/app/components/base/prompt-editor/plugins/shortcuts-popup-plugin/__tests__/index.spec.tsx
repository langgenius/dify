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
    const rectList = Object.assign([mockDOMRect], {
      item: (index: number) => (index === 0 ? mockDOMRect : null),
    })
    return rectList
  })

  // Mock getBoundingClientRect on Range prototype
  Range.prototype.getBoundingClientRect = vi.fn(() => mockDOMRect)
})

afterAll(() => {
  Range.prototype.getClientRects = originalRangeGetClientRects
  Range.prototype.getBoundingClientRect = originalRangeGetBoundingClientRect
})

const CONTAINER_ID = 'host'

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
          contentEditable={<ContentEditable aria-label="Prompt" />}
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
  const ce = screen.getByRole('textbox', { name: 'Prompt' })
  ce.focus()
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Prompt' }), { key, ...modifiers })
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
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Prompt' }), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText(SHORTCUTS_EMPTY_CONTENT)).not.toBeInTheDocument())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not open when editor is not focused', async () => {
    render(<MinimalEditor />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Prompt' }), {
      key: '/',
      ...(detectPlatform() === 'mac' ? { metaKey: true } : { ctrlKey: true }),
    })
    await waitFor(() => {
      expect(screen.queryByText(SHORTCUTS_EMPTY_CONTENT)).not.toBeInTheDocument()
    })
  })

  it('closes on click outside', async () => {
    render(<MinimalEditor />)
    const ce = screen.getByRole('textbox', { name: 'Prompt' })
    ce.focus()

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Prompt' }), {
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
    const ce = screen.getByRole('textbox', { name: 'Prompt' })
    ce.focus()

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Prompt' }), {
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
    expect(host).toContainElement(portalContent)
  })

  it('falls back to document.body when container is not provided', async () => {
    render(<MinimalEditor withContainer={false} />)
    focusAndTriggerHotkey('/')
    const portalContent = await screen.findByText(SHORTCUTS_EMPTY_CONTENT)
    expect(document.body).toContainElement(portalContent)
    expect(screen.getByTestId(CONTAINER_ID)).not.toContainElement(portalContent)
  })

  it('does not open for an extra modifier or composing input', () => {
    render(<MinimalEditor />)
    const editor = screen.getByRole('textbox', { name: 'Prompt' })
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
    const user = userEvent.setup()
    render(
      <MinimalEditor displayMode="workflow-panel-adjacent-center">
        {(_close: () => void, onInsert: ShortcutPopupInsertHandler) => (
          <div>
            <button
              type="button"

              onClick={() => onInsert(INSERT_TEXT, ['inserted', 'text'])}
            >
              Insert
            </button>
          </div>
        )}
      </MinimalEditor>,
    )
    focusAndTriggerHotkey('/')

    const insertBtn = await screen.findByRole('button', { name: 'Insert' })
    await user.click(insertBtn)
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveTextContent('inserted text'),
    )

    // After insert, the popup should close
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Insert' })).not.toBeInTheDocument()
    })
  })

  it('calls close via children render function close callback', async () => {
    const user = userEvent.setup()
    render(
      <MinimalEditor displayMode="workflow-panel-adjacent-center">
        {(close: () => void) => (
          <button type="button" onClick={close}>
            Close
          </button>
        )}
      </MinimalEditor>,
    )
    focusAndTriggerHotkey('/')

    const closeBtn = await screen.findByRole('button', { name: 'Close' })
    await user.click(closeBtn)

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
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
      screen.getByRole('textbox', { name: 'Prompt' }).dispatchEvent(escEvent)
    })

    await waitFor(() => {
      expect(screen.queryByText(SHORTCUTS_EMPTY_CONTENT)).not.toBeInTheDocument()
    })
    expect(escEvent.defaultPrevented).toBe(true)
    expect(parentKeyDown).not.toHaveBeenCalled()
  })
})
