import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { renderWorkflowBrowserComponent as render } from '../__tests__/workflow-browser-test-env'
import { MentionInput } from './mention-input'

function Draft() {
  const [value, setValue] = useState('')
  return (
    <div style={{ width: 320 }}>
      <MentionInput value={value} onChange={setValue} onSubmit={() => {}} placeholder="Draft" />
    </div>
  )
}

it('moves the actions below the text while it wraps and keeps the highlight layer aligned', async () => {
  // Browser-owned: text wrapping, flex layout and overlay geometry.
  await page.viewport(800, 600)
  const { queryClient } = createConsoleQueryWrapper({
    accountProfile: { id: 'author', name: 'Alice', avatar_url: null },
  })
  const screen = await render(<Draft />, {
    queryClient,
    initialStoreState: { mentionableUsersCache: { 'app-1': [] } },
  })
  const textarea = screen.getByPlaceholder('Draft')
  const send = screen.getByRole('button', { name: 'common.operation.send' })
  const sendTop = () => send.element().getBoundingClientRect().top
  const textBottom = () => textarea.element().getBoundingClientRect().bottom

  await textarea.click()
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
