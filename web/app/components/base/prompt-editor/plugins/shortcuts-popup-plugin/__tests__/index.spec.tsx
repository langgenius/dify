import { detectPlatform } from '@tanstack/react-hotkeys'
import { fireEvent, render, screen } from '@testing-library/react'
import { PopupEditor } from './editor-fixture'

// Browser Mode cannot synthesize native IME composition yet; keep only this event-contract case here.
it('leaves composing input to the IME instead of opening prompt actions', () => {
  render(<PopupEditor displayMode="workflow-panel-adjacent-center" />)
  const editor = screen.getByRole('textbox', { name: 'Prompt' })
  editor.focus()
  const modifier = detectPlatform() === 'mac' ? { metaKey: true } : { ctrlKey: true }
  // Establish that this focused editor really handles the shortcut before the IME guard.
  fireEvent.keyDown(editor, { key: '/', ...modifier })
  expect(screen.getByRole('region', { name: 'Prompt actions' })).toBeVisible()
  fireEvent.keyDown(editor, { key: 'Escape' })
  expect(screen.queryByRole('region', { name: 'Prompt actions' })).not.toBeInTheDocument()
  fireEvent.keyDown(editor, {
    key: '/',
    ...modifier,
    isComposing: true,
  })
  expect(screen.queryByRole('region', { name: 'Prompt actions' })).not.toBeInTheDocument()
})
