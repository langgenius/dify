import type { WorkflowCommentDetail } from '@dify/contracts/api/console/apps/types.gen'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { renderWorkflowBrowserComponent as render } from '../__tests__/workflow-browser-test-env'
import { seedMentionableUsers } from './__tests__/comment-query-data'
import { CommentThreadFixture } from './__tests__/comment-thread-fixture'

const author = { id: 'author', name: 'Alice', email: 'alice@example.com', avatar_url: null }
const comment: WorkflowCommentDetail = {
  id: 'comment',
  content: 'Review this node',
  created_by: 'author',
  created_by_account: author,
  position_x: 100,
  position_y: 100,
  created_at: 1,
  updated_at: 1,
  resolved: false,
  mentions: [],
  replies: [
    {
      id: 'reply',
      content: 'A reply',
      created_by: 'author',
      created_by_account: author,
      created_at: 2,
    },
    {
      id: 'second-reply',
      content: 'A second reply',
      created_by: 'author',
      created_by_account: author,
      created_at: 3,
    },
  ],
}

function Fixture({ onDelete }: { onDelete: (id: string) => void }) {
  const [detail, setDetail] = useState(comment)
  return (
    <>
      <button type="button">Outside thread</button>
      <div
        id="workflow-container"
        className="isolate"
        style={{ position: 'relative', width: 1000, height: 650 }}
      >
        <CommentThreadFixture
          comment={detail}
          onClose={() => {}}
          onReply={() => {}}
          onReplyEdit={() => {}}
          onReplyDelete={(id) => {
            onDelete(id)
            setDetail({ ...detail, replies: detail.replies.filter((reply) => reply.id !== id) })
          }}
        />
      </div>
    </>
  )
}

it('confirms reply deletion in its menu: cancel returns to the menu button, delete to the composer', async () => {
  // Native Tab and CSS visibility expose regressions hidden by DOM-only tests.
  await page.viewport(1200, 800)
  const onDelete = vi.fn()
  const { queryClient } = createConsoleQueryWrapper({
    accountProfile: { id: 'author', name: 'Alice', avatar_url: null },
  })
  seedMentionableUsers(queryClient, [])
  const screen = await render(<Fixture onDelete={onDelete} />, {
    queryClient,
  })
  const replyInput = screen.getByRole('textbox')
  await expect.element(replyInput).toHaveFocus()
  await userEvent.tab({ shift: true })
  const trigger = screen
    .getByRole('button', {
      name: 'workflowComments.comments.aria.replyActions',
    })
    .last()
  await expect.element(trigger).toHaveFocus()
  expect(trigger.element().checkVisibility({ checkOpacity: true })).toBe(true)
  await userEvent.keyboard('{ArrowDown}')
  const edit = screen.getByRole('menuitem', { name: 'workflowComments.comments.actions.editReply' })
  await expect.element(edit).toHaveFocus()
  await userEvent.keyboard('{End}')
  const deleteItem = screen.getByRole('menuitem', {
    name: 'workflowComments.comments.actions.deleteReply',
  })
  await expect.element(deleteItem).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  // The confirmation opens beside the menu button and starts on the safe choice.
  const confirmation = screen.getByRole('dialog', {
    name: 'workflowComments.comments.confirm.deleteReplyTitle',
  })
  const cancel = confirmation.getByRole('button', { name: 'common.operation.cancel' })
  await expect.element(cancel).toHaveFocus()
  await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
  // The menu button stays visible while the menu hands over to the confirmation.
  expect(trigger.element().checkVisibility({ checkOpacity: true })).toBe(true)
  await userEvent.keyboard('{Enter}')
  await expect.element(confirmation).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  expect(trigger.element().checkVisibility({ checkOpacity: true })).toBe(true)
  expect(onDelete).not.toHaveBeenCalled()

  await trigger.click()
  await deleteItem.click()
  await confirmation.getByRole('button', { name: 'common.operation.delete' }).click()
  expect(onDelete).toHaveBeenCalledExactlyOnceWith('second-reply')
  await expect.element(screen.getByText('A second reply')).not.toBeInTheDocument()
  await expect.element(screen.getByText('A reply')).toBeVisible()
  await expect.element(replyInput).toHaveFocus()
})

it('moves focus into the edit field when a reply is edited from its menu, and back on Escape', async () => {
  await page.viewport(1200, 800)
  const { queryClient } = createConsoleQueryWrapper({
    accountProfile: { id: 'author', name: 'Alice', avatar_url: null },
  })
  seedMentionableUsers(queryClient, [])
  const screen = await render(<Fixture onDelete={() => {}} />, {
    queryClient,
  })
  await expect.element(screen.getByRole('textbox')).toHaveFocus()
  // Focus the marker first, as a keyboard user who opened the thread from it would have.
  screen.getByRole('button', { name: 'Marker' }).element().focus()
  const trigger = screen
    .getByRole('button', { name: 'workflowComments.comments.aria.replyActions' })
    .last()
  ;(trigger.element() as HTMLElement).focus()
  await userEvent.keyboard('{Enter}')
  const edit = screen.getByRole('menuitem', { name: 'workflowComments.comments.actions.editReply' })
  await expect.element(edit).toHaveFocus()
  await userEvent.keyboard('{Enter}')

  const editField = screen.getByPlaceholder('workflowComments.comments.placeholder.editReply')
  // Focus must survive the menu's close transition, which applies its final focus on removal.
  await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
  await expect.element(editField).toHaveFocus()
  expect((editField.element() as HTMLTextAreaElement).selectionStart).toBe('A second reply'.length)

  await userEvent.keyboard('{Escape}')
  await expect.element(editField).not.toBeInTheDocument()
  await expect.element(screen.getByRole('dialog')).toBeVisible()
})

it('closes the mention list before the thread on Escape', async () => {
  await page.viewport(1200, 800)
  const onClose = vi.fn()
  const { queryClient } = createConsoleQueryWrapper({
    accountProfile: { id: 'author', name: 'Alice', avatar_url: null },
  })
  seedMentionableUsers(queryClient, [
    { id: 'bob', name: 'Bob', email: 'bob@example.com', avatar_url: null },
  ])
  const screen = await render(
    <CommentThreadFixture comment={comment} onClose={onClose} onReply={() => {}} />,
    {
      queryClient,
    },
  )
  const reply = screen.getByRole('textbox')
  await expect.element(reply).toHaveFocus()
  await userEvent.keyboard('@')
  await expect.element(screen.getByRole('listbox')).toBeVisible()

  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('listbox')).not.toBeInTheDocument()
  expect(onClose).not.toHaveBeenCalled()
  await userEvent.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledTimes(1)
})
