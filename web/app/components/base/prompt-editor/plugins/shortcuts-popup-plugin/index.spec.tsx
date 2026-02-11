import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { useState } from 'react'
import ShortcutsPopupPlugin, { SHORTCUTS_EMPTY_CONTENT } from './index'
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

beforeAll(() => {
  // Mock getClientRects on Range prototype
  Range.prototype.getClientRects = vi.fn(() => {
    const rectList = [mockDOMRect] as unknown as DOMRectList
    Object.defineProperty(rectList, 'length', { value: 1 })
    Object.defineProperty(rectList, 'item', { value: (index: number) => index === 0 ? mockDOMRect : null })
    return rectList
  })

  // Mock getBoundingClientRect on Range prototype
  Range.prototype.getBoundingClientRect = vi.fn(() => mockDOMRect as DOMRect)
})

const CONTAINER_ID = 'host'
const CONTENT_EDITABLE_ID = 'ce'

const MinimalEditor: React.FC<{
  withContainer?: boolean
}> = ({ withContainer = true }) => {
  const initialConfig = {
    namespace: 'shortcuts-popup-plugin-test',
    onError: (e: Error) => {
      throw e
    },
  }
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null)

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div data-testid={CONTAINER_ID} className="relative" ref={withContainer ? setContainerEl : undefined}>
        <RichTextPlugin
          contentEditable={<ContentEditable data-testid={CONTENT_EDITABLE_ID} />}
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <ShortcutsPopupPlugin
          container={withContainer ? containerEl : undefined}
        />
      </div>
    </LexicalComposer>
  )
}

describe('ShortcutsPopupPlugin', () => {
  it('opens on hotkey when editor is focused', async () => {
    render(<MinimalEditor />)
    const ce = screen.getByTestId(CONTENT_EDITABLE_ID)
    ce.focus()

    fireEvent.keyDown(document, { key: '/', ctrlKey: true }) // 模拟 Ctrl+/
    expect(await screen.findByText(SHORTCUTS_EMPTY_CONTENT)).toBeInTheDocument()
  })

  it('does not open when editor is not focused', async () => {
    render(<MinimalEditor />)
    // 未聚焦
    fireEvent.keyDown(document, { key: '/', ctrlKey: true })
    await waitFor(() => {
      expect(screen.queryByText(SHORTCUTS_EMPTY_CONTENT)).not.toBeInTheDocument()
    })
  })

  it('closes on Escape', async () => {
    render(<MinimalEditor />)
    const ce = screen.getByTestId(CONTENT_EDITABLE_ID)
    ce.focus()

    fireEvent.keyDown(document, { key: '/', ctrlKey: true })
    expect(await screen.findByText(SHORTCUTS_EMPTY_CONTENT)).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByText(SHORTCUTS_EMPTY_CONTENT)).not.toBeInTheDocument()
    })
  })

  it('closes on click outside', async () => {
    render(<MinimalEditor />)
    const ce = screen.getByTestId(CONTENT_EDITABLE_ID)
    ce.focus()

    fireEvent.keyDown(document, { key: '/', ctrlKey: true })
    expect(await screen.findByText(SHORTCUTS_EMPTY_CONTENT)).toBeInTheDocument()

    fireEvent.mouseDown(ce)
    await waitFor(() => {
      expect(screen.queryByText(SHORTCUTS_EMPTY_CONTENT)).not.toBeInTheDocument()
    })
  })

  it('portals into provided container when container is set', async () => {
    render(<MinimalEditor withContainer />)
    const ce = screen.getByTestId(CONTENT_EDITABLE_ID)
    const host = screen.getByTestId(CONTAINER_ID)
    ce.focus()

    fireEvent.keyDown(document, { key: '/', ctrlKey: true })
    const portalContent = await screen.findByText(SHORTCUTS_EMPTY_CONTENT)
    expect(host).toContainElement(portalContent)
  })

  it('falls back to document.body when container is not provided', async () => {
    render(<MinimalEditor withContainer={false} />)
    const ce = screen.getByTestId(CONTENT_EDITABLE_ID)
    ce.focus()

    fireEvent.keyDown(document, { key: '/', ctrlKey: true })
    const portalContent = await screen.findByText(SHORTCUTS_EMPTY_CONTENT)
    expect(document.body).toContainElement(portalContent)
  })
})
