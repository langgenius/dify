import type { LexicalEditor } from 'lexical'
import { $createLinkNode, $isLinkNode, LinkNode } from '@lexical/link'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { $createParagraphNode, $createTextNode, $getRoot, $isElementNode } from 'lexical'
import NoteEditorContext from '../../../context'
import { createNoteEditorStore } from '../../../store'
import LinkEditorComponent from '../component'

const hosts: HTMLElement[] = []
afterEach(() => {
  cleanup()
  hosts.splice(0).forEach((host) => host.remove())
})

function setup(url: string) {
  const store = createNoteEditorStore()
  const anchor = document.createElement('button')
  const portalRoot = document.createElement('div')
  document.body.append(anchor, portalRoot)
  hosts.push(anchor, portalRoot)
  store.setState({ linkAnchorElement: anchor, linkOperatorShow: false, selectedLinkUrl: url })
  let editor: LexicalEditor
  function CaptureEditor() {
    ;[editor] = useLexicalComposerContext()
    return null
  }
  render(
    <LexicalComposer
      initialConfig={{
        namespace: 'link-edit',
        nodes: [LinkNode],
        onError: (error) => {
          throw error
        },
        editorState: () => {
          const text = $createTextNode('Documentation')
          $getRoot().append($createParagraphNode().append($createLinkNode(url).append(text)))
          text.select(0, text.getTextContentSize())
        },
      }}
    >
      <CaptureEditor />
      <LinkPlugin />
      <NoteEditorContext value={store}>
        <LinkEditorComponent containerElement={portalRoot} />
      </NoteEditorContext>
    </LexicalComposer>,
  )
  return {
    readLink: () =>
      editor.getEditorState().read(() => {
        const paragraph = $getRoot().getFirstChildOrThrow()
        const node = $isElementNode(paragraph) ? paragraph.getFirstChild() : null
        return $isLinkNode(node) ? node.getURL() : null
      }),
    readText: () => editor.getEditorState().read(() => $getRoot().getTextContent()),
  }
}

it.each(['Escape', 'outside click'])(
  'removes a new empty link on %s while keeping its text',
  async (action) => {
    const user = userEvent.setup()
    const editor = setup('')
    await screen.findByRole('textbox')
    if (action === 'Escape') await user.keyboard('{Escape}')
    else await user.click(document.body)
    await waitFor(() => expect(editor.readLink()).toBeNull())
    expect(editor.readText()).toBe('Documentation')
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
  },
)

it.each(['button', 'Enter'])(
  'saves an edited URL through %s into the real editor',
  async (action) => {
    const user = userEvent.setup()
    const editor = setup('https://example.com')
    const input = await screen.findByRole('textbox')
    await user.clear(input)
    await user.type(input, 'https://dify.ai/docs')
    if (action === 'Enter') await user.keyboard('{Enter}')
    else await user.click(screen.getByRole('button', { name: 'common.operation.ok' }))
    await waitFor(() => expect(editor.readLink()).toBe('https://dify.ai/docs'))
    expect(editor.readText()).toBe('Documentation')
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
  },
)
