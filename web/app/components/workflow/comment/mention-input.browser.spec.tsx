import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { renderWorkflowBrowserComponent as render } from '../__tests__/workflow-browser-test-env'
import { seedMentionableUsers } from './__tests__/comment-query-data'
import { MentionInput } from './mention-input'

const users = [
  { id: 'bob', name: 'Bob', email: 'bob@example.com', avatar_url: '' },
  { id: 'carol', name: 'Carol', email: 'carol@example.com', avatar_url: '' },
]

let setOffset: (offset: number) => void = () => {}

function Draft({ initialOffset = 0, onClose }: { initialOffset?: number; onClose?: () => void }) {
  const [value, setValue] = useState('')
  const [offset, setOffsetState] = useState(initialOffset)
  setOffset = setOffsetState
  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Stands in for the thread's bubbling Escape handler.
    <div
      style={{ width: 320, marginTop: offset }}
      onKeyDown={(event) => {
        if (!event.defaultPrevented && event.key === 'Escape') onClose?.()
      }}
    >
      <MentionInput value={value} onChange={setValue} onSubmit={() => {}} placeholder="Draft" />
    </div>
  )
}

async function renderDraft(props: Parameters<typeof Draft>[0] = {}) {
  await page.viewport(800, 600)
  const { queryClient } = createConsoleQueryWrapper({
    accountProfile: { id: 'author', name: 'Alice', avatar_url: null },
  })
  seedMentionableUsers(queryClient, users)
  const screen = await render(<Draft {...props} />, {
    queryClient,
    resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
  })
  const textarea = screen.getByPlaceholder('Draft')
  await textarea.click()
  return { screen, textarea }
}

it('moves the actions below the text while it wraps and keeps the highlight layer aligned', async () => {
  // Browser-owned: text wrapping, flex layout and overlay geometry.
  const { screen, textarea } = await renderDraft()
  const send = screen.getByRole('button', { name: 'common.operation.send' })
  const sendTop = () => send.element().getBoundingClientRect().top
  const textBottom = () => textarea.element().getBoundingClientRect().bottom

  await userEvent.keyboard('Short')
  await expect.poll(() => sendTop() < textBottom()).toBe(true)

  await userEvent.keyboard(' and a much longer sentence that has to wrap onto a second line')
  await expect.poll(() => sendTop() >= textBottom()).toBe(true)
  const overlay = textarea.element().previousElementSibling!.getBoundingClientRect()
  const field = textarea.element().getBoundingClientRect()
  expect(overlay.top).toBe(field.top)
  expect(overlay.height).toBe(field.height)

  await userEvent.clear(textarea)
  await userEvent.keyboard('Short')
  await expect.poll(() => sendTop() < textBottom()).toBe(true)
})

it('drives the mention list from the textarea and closes it with Escape without leaving the editor', async () => {
  // Browser-owned: focus stays in the textarea while the anchored list is navigated.
  const onClose = vi.fn()
  const { screen, textarea } = await renderDraft({ onClose })
  await userEvent.keyboard('@')
  const listbox = screen.getByRole('listbox')
  await expect.element(listbox).toBeVisible()
  await expect.element(textarea).toHaveFocus()
  const options = screen.getByRole('option')
  await expect
    .element(textarea)
    .toHaveAttribute('aria-activedescendant', options.first().element().id)
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(options.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect
    .element(textarea)
    .toHaveAttribute('aria-activedescendant', options.nth(1).element().id)
  await userEvent.keyboard('{Tab}')
  await expect.element(textarea).toHaveValue('@Carol ')
  await expect.element(textarea).toHaveFocus()
  await expect.element(listbox).not.toBeInTheDocument()

  await userEvent.keyboard('@')
  await expect.element(screen.getByRole('listbox')).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('listbox')).not.toBeInTheDocument()
  await expect.element(textarea).toHaveFocus()
  expect(onClose).not.toHaveBeenCalled()
})

it('keeps the mention list anchored when the input moves and flips it above near the bottom edge', async () => {
  // Browser-owned: anchored positioning, layout changes and viewport collision.
  const { screen, textarea } = await renderDraft()
  await userEvent.keyboard('@')
  const listbox = screen.getByRole('listbox')
  await expect.element(listbox).toBeVisible()
  const gap = () =>
    listbox.element().getBoundingClientRect().top -
    textarea.element().getBoundingClientRect().bottom
  await expect.poll(() => gap()).toBeGreaterThanOrEqual(0)
  const initialGap = gap()
  const initialTop = textarea.element().getBoundingClientRect().top
  setOffset(120)
  await expect.poll(() => textarea.element().getBoundingClientRect().top).toBe(initialTop + 120)
  await expect.poll(() => gap()).toBeCloseTo(initialGap, 0)

  setOffset(560)
  await expect
    .poll(
      () =>
        listbox.element().getBoundingClientRect().bottom <=
        textarea.element().getBoundingClientRect().top,
    )
    .toBe(true)
})
