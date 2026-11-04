import { $createLinkNode, LinkNode } from '@lexical/link'
import { $createListItemNode, $createListNode, ListItemNode, ListNode } from '@lexical/list'
import { act, waitFor } from '@testing-library/react'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import {
  renderLexicalEditor,
  waitForEditorReady,
} from '@/app/components/base/prompt-editor/plugins/__tests__/test-helpers'
import NoteEditorContext from '../../../context'
import { createNoteEditorStore } from '../../../store'
import { useFormatDetector } from '../hooks'

const Detector = () => {
  useFormatDetector()
  return null
}

const setup = async () => {
  const store = createNoteEditorStore()
  const view = renderLexicalEditor({
    namespace: 'note-format-detector',
    nodes: [LinkNode, ListNode, ListItemNode],
    children: (
      <NoteEditorContext.Provider value={store}>
        <Detector />
      </NoteEditorContext.Provider>
    ),
  })
  const editor = await waitForEditorReady(view.getEditor)
  return { ...view, editor, store }
}

it('detects formatting and links nested in a list, then clears them for plain text', async () => {
  const { editor, store } = await setup()
  let linkKey = ''
  act(() =>
    editor.update(
      () => {
        const text = $createTextNode('Linked item')
          .toggleFormat('bold')
          .toggleFormat('strikethrough')
        const link = $createLinkNode('https://dify.ai').append(text)
        linkKey = link.getKey()
        $getRoot()
          .clear()
          .append($createListNode('bullet').append($createListItemNode().append(link)))
        text.select(0, text.getTextContentSize()).format = text.getFormat()
      },
      { discrete: true },
    ),
  )
  await waitFor(() =>
    expect(store.getState()).toMatchObject({
      selectedIsBold: true,
      selectedIsItalic: false,
      selectedIsStrikeThrough: true,
      selectedIsLink: true,
      selectedLinkUrl: 'https://dify.ai',
      selectedLinkKey: linkKey,
      selectedIsBullet: true,
    }),
  )

  act(() =>
    editor.update(
      () => {
        const text = $createTextNode('Plain text')
        $getRoot().clear().append($createParagraphNode().append(text))
        text.select(0, text.getTextContentSize()).format = text.getFormat()
      },
      { discrete: true },
    ),
  )
  act(() => {
    document.dispatchEvent(new Event('selectionchange'))
  })
  expect(store.getState()).toMatchObject({
    selectedIsBold: false,
    selectedIsItalic: false,
    selectedIsStrikeThrough: false,
    selectedIsLink: false,
    selectedLinkUrl: '',
    selectedLinkKey: null,
    selectedIsBullet: false,
  })
})

it('defers format changes during composition and stops observing after unmount', async () => {
  const { editor, store, unmount } = await setup()
  const composing = vi.spyOn(editor, 'isComposing').mockReturnValue(true)
  act(() =>
    editor.update(
      () => {
        const text = $createTextNode('Composing').toggleFormat('italic')
        $getRoot().clear().append($createParagraphNode().append(text))
        text.select(0, text.getTextContentSize()).format = text.getFormat()
      },
      { discrete: true },
    ),
  )
  expect(store.getState().selectedIsItalic).toBe(false)
  composing.mockRestore()
  act(() => {
    document.dispatchEvent(new Event('selectionchange'))
  })
  expect(store.getState().selectedIsItalic).toBe(true)

  unmount()
  store.setState({ selectedIsItalic: false })
  act(() => {
    document.dispatchEvent(new Event('selectionchange'))
  })
  expect(store.getState().selectedIsItalic).toBe(false)
})
