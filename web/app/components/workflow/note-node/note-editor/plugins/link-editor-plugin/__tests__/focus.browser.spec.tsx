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

function Harness({ secondLinkUrl }: { secondLinkUrl?: string }) {
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
          const paragraph = $createParagraphNode().append(
            $createLinkNode('https://example.com').append($createTextNode('hello')),
          )
          if (secondLinkUrl) {
            paragraph.append(
              $createTextNode(' '),
              $createLinkNode(secondLinkUrl).append($createTextNode('world')),
            )
          }
          $getRoot().append(paragraph)
        },
      }}
    >
      <NoteEditorContext value={store}>
        <div ref={setContainer} style={{ padding: 100 }}>
          <section aria-label="Note editor">
            <Editor containerElement={container} />
          </section>
          <button type="button" style={{ display: 'block', marginTop: 100 }}>
            Outside action
          </button>
        </div>
      </NoteEditorContext>
    </LexicalComposer>
  )
}

// Chromium owns contenteditable selection and the native input that follows focus restoration.
it.each(['URL input', 'confirm button', 'toolbar edit button'])(
  'dismisses the entire link popup with Escape from the %s until explicitly reopened',
  async (target) => {
    await render(<Harness />)
    const note = page.getByRole('region', { name: 'Note editor' }).getByRole('textbox')
    const edit = page.getByRole('button', { name: 'common.operation.edit', exact: true })
    const openLink = page.getByRole('link', { name: /workflow.nodes.note.editor.openLink/ })
    const urlInput = page.getByPlaceholder('workflow.nodes.note.editor.enterUrl')
    await note.click()
    await userEvent.keyboard('{Home}{ArrowRight}{ArrowRight}')

    if (target === 'toolbar edit button') {
      await expect.element(openLink).toBeVisible()
      ;(openLink.element() as HTMLAnchorElement).focus()
      await userEvent.keyboard('{Tab}')
      await expect.element(edit).toHaveFocus()
    } else {
      await edit.click()
      await expect.element(urlInput).toHaveFocus()
      if (target === 'confirm button') {
        await userEvent.keyboard('{Tab}')
        await expect
          .element(page.getByRole('button', { name: 'common.operation.ok' }))
          .toHaveFocus()
      }
    }

    await userEvent.keyboard('{Escape}')

    await expect.element(note).toHaveFocus()
    await expect.element(urlInput).not.toBeInTheDocument()
    await expect.element(openLink).not.toBeInTheDocument()
    await expect.element(edit).not.toBeInTheDocument()
    await userEvent.keyboard('X')
    await expect.element(note).toHaveTextContent('heXllo')
    await expect.element(urlInput).not.toBeInTheDocument()
    await expect.element(openLink).not.toBeInTheDocument()
    await expect.element(edit).not.toBeInTheDocument()

    await page.getByRole('link', { name: 'heXllo' }).click()

    await expect.element(openLink).toBeVisible()
    await expect.element(edit).toBeVisible()
  },
)

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
  const note = page.getByRole('region', { name: 'Note editor' }).getByRole('textbox')
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
    const note = page.getByRole('region', { name: 'Note editor' }).getByRole('textbox')
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

it.each(['https://second.example.com', 'https://example.com'])(
  'opens a different link after dismissing the first when its URL is %s',
  async (secondLinkUrl) => {
    await render(<Harness secondLinkUrl={secondLinkUrl} />)
    const note = page.getByRole('region', { name: 'Note editor' }).getByRole('textbox')
    const openLink = page.getByRole('link', { name: /workflow.nodes.note.editor.openLink/ })
    await expect.element(page.getByRole('link', { name: 'hello', exact: true })).toBeVisible()
    await expect.element(page.getByRole('link', { name: 'world', exact: true })).toBeVisible()
    await note.click()
    await userEvent.keyboard('{Home}{ArrowRight}')
    await page.getByRole('button', { name: 'common.operation.edit', exact: true }).click()
    await userEvent.keyboard('{Escape}')
    await expect.element(note).toHaveFocus()
    await expect.element(openLink).not.toBeInTheDocument()

    await userEvent.keyboard('{End}{ArrowLeft}')

    await expect.element(openLink).toBeVisible()
    await expect.element(openLink).toHaveAttribute('href', secondLinkUrl)
  },
)
