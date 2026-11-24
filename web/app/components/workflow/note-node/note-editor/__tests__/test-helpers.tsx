import { LinkNode } from '@lexical/link'
import { ListItemNode, ListNode } from '@lexical/list'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { act } from '@testing-library/react'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import {
  renderLexicalEditor,
  waitForEditorReady,
} from '@/app/components/base/prompt-editor/plugins/__tests__/test-helpers'
import NoteEditorContext from '../context'
import { useFormatDetector } from '../plugins/format-detector-plugin/hooks'
import { createNoteEditorStore } from '../store'

export async function renderNoteHook<T>(useHook: () => T) {
  const store = createNoteEditorStore()
  let value: T
  function Probe() {
    useFormatDetector()
    value = useHook()
    return (
      <>
        <RichTextPlugin
          contentEditable={<ContentEditable aria-label="Note" />}
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <LinkPlugin />
        <ListPlugin />
      </>
    )
  }
  const view = renderLexicalEditor({
    namespace: 'note-hooks',
    nodes: [LinkNode, ListNode, ListItemNode],
    children: (
      <NoteEditorContext.Provider value={store}>
        <Probe />
      </NoteEditorContext.Provider>
    ),
  })
  const editor = await waitForEditorReady(view.getEditor)
  const update = (callback: () => void) => act(() => editor.update(callback, { discrete: true }))
  update(() => {
    const text = $createTextNode('Selected note').setStyle('font-size: 16px')
    $getRoot().clear().append($createParagraphNode().append(text))
    text.select(0, text.getTextContentSize())
  })
  return {
    ...view,
    editor,
    store,
    update,
    get value() {
      return value!
    },
  }
}
