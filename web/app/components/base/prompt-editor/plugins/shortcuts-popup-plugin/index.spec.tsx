import React, { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import ShortcutsPopupPlugin, { SHORTCUTS_EMPTY_CONTENT } from './index'

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
  test('opens on hotkey when editor is focused', async () => {
    render(<MinimalEditor />)
    const ce = screen.getByTestId(CONTENT_EDITABLE_ID)
    ce.focus()

    fireEvent.keyDown(document, { key: '/', ctrlKey: true }) // 模拟 Ctrl+/
    expect(await screen.findByText(SHORTCUTS_EMPTY_CONTENT)).toBeInTheDocument()
  })

  test('does not open when editor is not focused', async () => {
    render(<MinimalEditor />)
    // 未聚焦
    fireEvent.keyDown(document, { key: '/', ctrlKey: true })
    await waitFor(() => {
      expect(screen.queryByText(SHORTCUTS_EMPTY_CONTENT)).not.toBeInTheDocument()
    })
  })

  test('closes on Escape', async () => {
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

  test('closes on click outside', async () => {
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

  test('portals into provided container when container is set', async () => {
    render(<MinimalEditor withContainer />)
    const ce = screen.getByTestId(CONTENT_EDITABLE_ID)
    const host = screen.getByTestId(CONTAINER_ID)
    ce.focus()

    fireEvent.keyDown(document, { key: '/', ctrlKey: true })
    const portalContent = await screen.findByText(SHORTCUTS_EMPTY_CONTENT)
    expect(host).toContainElement(portalContent)
  })

  test('falls back to document.body when container is not provided', async () => {
    render(<MinimalEditor withContainer={false} />)
    const ce = screen.getByTestId(CONTENT_EDITABLE_ID)
    ce.focus()

    fireEvent.keyDown(document, { key: '/', ctrlKey: true })
    const portalContent = await screen.findByText(SHORTCUTS_EMPTY_CONTENT)
    expect(document.body).toContainElement(portalContent)
  })
})
