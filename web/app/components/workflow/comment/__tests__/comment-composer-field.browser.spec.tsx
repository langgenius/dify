import { render } from 'vitest-browser-react'
import { CommentComposerActions, CommentComposerField } from '../comment-composer'

const longText = Array.from({ length: 12 }, () => 'Check the refund branch again.').join(' ')

async function renderField(value: string, editing = false) {
  const screen = await render(
    <div style={{ width: 320 }}>
      <CommentComposerField
        aria-label="Comment"
        value={value}
        mentionNames={['Sam']}
        editing={editing}
        onChange={() => {}}
        actions={editing ? <button type="button">Save</button> : <CommentComposerActions canSend />}
      />
    </div>,
  )
  const textarea = screen.getByRole('textbox', { name: 'Comment' })
  await expect.element(textarea).toBeVisible()
  const element = textarea.element() as HTMLTextAreaElement
  const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight)
  return { screen, element, lineHeight }
}

it('keeps a single line beside its actions', async () => {
  const { screen, element, lineHeight } = await renderField('@Sam looks good')
  const send = screen.getByRole('button', { name: 'common.operation.send' }).element()

  expect(element.closest('[data-multiline]')).toBeNull()
  expect(element.getBoundingClientRect().height).toBeCloseTo(lineHeight, 0)
  expect(send.getBoundingClientRect().left).toBeGreaterThanOrEqual(
    element.getBoundingClientRect().right - 1,
  )
})

it('grows to four lines above its actions and scrolls past them', async () => {
  const { screen, element, lineHeight } = await renderField(longText)
  const send = screen.getByRole('button', { name: 'common.operation.send' }).element()

  await expect.poll(() => element.closest('[data-multiline]')).not.toBeNull()
  await expect.poll(() => element.getBoundingClientRect().height).toBeCloseTo(lineHeight * 4, 0)
  expect(element.scrollHeight).toBeGreaterThan(element.clientHeight)
  expect(send.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    element.getBoundingClientRect().bottom - 1,
  )
})

it('starts an edited comment at two lines', async () => {
  const { element, lineHeight } = await renderField('Short', true)

  expect(element.getBoundingClientRect().height).toBeCloseTo(lineHeight * 2, 0)
})
