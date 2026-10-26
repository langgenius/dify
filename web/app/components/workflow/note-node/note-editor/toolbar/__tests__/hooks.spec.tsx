import { $isLinkNode } from '@lexical/link'
import { $isListNode } from '@lexical/list'
import { $getRoot, $getSelection, $isRangeSelection, $setSelection } from 'lexical'
import { renderNoteHook } from '../../__tests__/test-helpers'
import { useCommand, useFontSize } from '../hooks'

it('formats selected text and toggles links using real Lexical commands', async () => {
  const hook = await renderNoteHook(useCommand)
  hook.update(() => {
    hook.value.handleCommand('bold')
    hook.value.handleCommand('italic')
    hook.value.handleCommand('strikethrough')
    hook.value.handleCommand('link')
  })
  hook.editor.getEditorState().read(() => {
    const text = $getRoot().getAllTextNodes()[0]!
    expect(text.hasFormat('bold')).toBe(true)
    expect(text.hasFormat('italic')).toBe(true)
    expect(text.hasFormat('strikethrough')).toBe(true)
    expect($isLinkNode(text.getParent())).toBe(true)
  })
  hook.update(() => hook.value.handleCommand('link'))
  hook.editor.getEditorState().read(() => {
    expect($isLinkNode($getRoot().getAllTextNodes()[0]!.getParent())).toBe(false)
    expect($getRoot().getTextContent()).toBe('Selected note')
  })
})

it('toggles a selected paragraph into and out of a bullet list', async () => {
  const hook = await renderNoteHook(useCommand)
  hook.update(() => hook.value.handleCommand('bullet'))
  hook.editor
    .getEditorState()
    .read(() => expect($isListNode($getRoot().getFirstChild())).toBe(true))
  expect(hook.store.getState().selectedIsBullet).toBe(true)
  hook.update(() => hook.value.handleCommand('bullet'))
  hook.editor.getEditorState().read(() => {
    expect($getRoot().getFirstChild()!.getType()).toBe('paragraph')
    expect($getRoot().getTextContent()).toBe('Selected note')
  })
})

it('preserves the selected range when opening the font chooser and applies its font size', async () => {
  const hook = await renderNoteHook(useFontSize)
  expect(hook.value.fontSize).toBe('16px')
  hook.update(() => hook.value.handleOpenFontSizeSelector(true))
  expect(hook.value.fontSizeSelectorShow).toBe(true)
  hook.update(() => hook.value.handleFontSize('20px'))
  expect(hook.value.fontSize).toBe('20px')
  hook.editor.getEditorState().read(() => {
    const selection = $getSelection()
    expect($isRangeSelection(selection) && selection.getTextContent()).toBe('Selected note')
    expect($getRoot().getAllTextNodes()[0]!.getStyle()).toContain('font-size: 20px')
  })
})

it('leaves content unchanged when link or font commands have no range selection', async () => {
  const hook = await renderNoteHook(() => ({ ...useCommand(), ...useFontSize() }))
  hook.update(() => $setSelection(null))
  const before = hook.editor.getEditorState().toJSON()
  hook.update(() => {
    hook.value.handleCommand('link')
    hook.value.handleFontSize('20px')
  })
  expect(hook.editor.getEditorState().toJSON()).toEqual(before)
  expect(hook.store.getState().linkAnchorElement).toBeNull()
})
