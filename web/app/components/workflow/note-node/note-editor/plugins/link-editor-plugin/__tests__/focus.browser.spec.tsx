import { $createLinkNode, LinkNode } from '@lexical/link'
import { ListItemNode, ListNode } from '@lexical/list'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import NoteEditorContext from '../../../context'
import Editor from '../../../editor'
import { createNoteEditorStore } from '../../../store'
import theme from '../../../theme'

function Harness() {
  const [store] = useState(createNoteEditorStore)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)

  return (
    <LexicalComposer
      initialConfig={{
        namespace: 'link-focus-test',
        nodes: [LinkNode, ListNode, ListItemNode],
        theme,
        onError: (error) => {
          throw error
        },
        editorState: () => {
          $getRoot().append(
            $createParagraphNode().append(
              $createLinkNode('https://example.com').append($createTextNode('hello')),
            ),
          )
        },
      }}
    >
      <NoteEditorContext value={store}>
        <div ref={setContainer} style={{ padding: 100 }}>
          <Editor containerElement={container} />
          <button type="button" style={{ display: 'block', marginTop: 100 }}>
            Outside action
          </button>
        </div>
      </NoteEditorContext>
    </LexicalComposer>
  )
}

// Chromium owns contenteditable selection and the native input that follows focus restoration.
it('resumes typing at the saved note selection after cancelling link editing', async () => {
  await render(<Harness />)
  const note = page.getByRole('textbox', { name: '' })
  await note.click()
  await userEvent.keyboard('{Home}{ArrowRight}{ArrowRight}')
  await page.getByRole('button', { name: 'common.operation.edit', exact: true }).click()
  await expect.element(page.getByPlaceholder('workflow.nodes.note.editor.enterUrl')).toHaveFocus()

  await userEvent.keyboard('{Escape}')

  await expect.element(note).toHaveFocus()
  await userEvent.keyboard('X')
  await expect.element(note).toHaveTextContent('heXllo')
})

it('keeps focus on the outside action when it dismisses link editing', async () => {
  await render(<Harness />)
  await page.getByRole('link', { name: 'hello' }).click()
  await page.getByRole('button', { name: 'common.operation.edit', exact: true }).click()
  const outside = page.getByRole('button', { name: 'Outside action' })

  await outside.click()

  await expect
    .element(page.getByPlaceholder('workflow.nodes.note.editor.enterUrl'))
    .not.toBeInTheDocument()
  await expect.element(outside).toHaveFocus()
})

// Native button activation and sequential focus navigation must preserve the Lexical selection.
it.each(['{Enter}', '{Space}'])('opens link editing with %s from the keyboard', async (key) => {
  await render(<Harness />)
  const note = page.getByRole('textbox', { name: '' })
  await note.click()
  await userEvent.keyboard('{Home}{ArrowRight}{ArrowRight}')
  const openLink = page.getByRole('link', { name: /workflow.nodes.note.editor.openLink/ })
  await expect.element(openLink).toBeVisible()
  ;(openLink.element() as HTMLAnchorElement).focus()
  await userEvent.keyboard('{Tab}')
  const edit = page.getByRole('button', { name: 'common.operation.edit', exact: true })
  await expect.element(edit).toHaveFocus()
  await userEvent.keyboard('{Tab}')
  await expect
    .element(page.getByRole('button', { name: 'workflow.nodes.note.editor.unlink' }))
    .toHaveFocus()
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
  await expect.element(edit).toHaveFocus()

  await userEvent.keyboard(key)

  await expect.element(page.getByPlaceholder('workflow.nodes.note.editor.enterUrl')).toHaveFocus()
  await userEvent.keyboard('{Escape}X')
  await expect.element(note).toHaveTextContent('heXllo')
})

it.each(['{Enter}', '{Space}'])(
  'removes the selected link with %s from the keyboard',
  async (key) => {
    await render(<Harness />)
    const note = page.getByRole('textbox', { name: '' })
    await note.click()
    await userEvent.keyboard('{Home}{ArrowRight}{ArrowRight}')
    const openLink = page.getByRole('link', { name: /workflow.nodes.note.editor.openLink/ })
    await expect.element(openLink).toBeVisible()
    ;(openLink.element() as HTMLAnchorElement).focus()
    await userEvent.keyboard('{Tab}{Tab}')
    await expect
      .element(page.getByRole('button', { name: 'workflow.nodes.note.editor.unlink' }))
      .toHaveFocus()

    await userEvent.keyboard(key)

    await expect.element(page.getByRole('link', { name: 'hello' })).not.toBeInTheDocument()
    await expect.element(note).toHaveFocus()
    await userEvent.keyboard('X')
    await expect.element(note).toHaveTextContent('heXllo')
  },
)
