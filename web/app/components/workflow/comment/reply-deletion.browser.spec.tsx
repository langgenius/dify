import type { WorkflowCommentDetail } from '@dify/contracts/api/console/apps/types.gen'
import { page, userEvent } from 'vite-plus/test/browser'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { renderWorkflowBrowserComponent as render } from '../__tests__/workflow-browser-test-env'
import { CommentThread } from './thread'

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
  ],
}

function Fixture({ onDelete }: { onDelete: (id: string) => void }) {
  return (
    <>
      <button type="button">Outside thread</button>
      <div id="workflow-container" style={{ position: 'relative', width: 1000, height: 650 }}>
        <CommentThread
          comment={comment}
          onClose={() => {}}
          onReply={() => {}}
          onReplyEdit={() => {}}
          onReplyDeleteDirect={onDelete}
        />
      </div>
    </>
  )
}

it('lets keyboard users request reply deletion and returns focus to reply actions when cancelled', async () => {
  // Native Tab and CSS visibility expose regressions hidden by DOM-only tests.
  await page.viewport(1200, 800)
  const onDelete = vi.fn()
  const { queryClient } = createConsoleQueryWrapper({
    accountProfile: { id: 'author', name: 'Alice', avatar_url: null },
  })
  const screen = await render(<Fixture onDelete={onDelete} />, {
    queryClient,
    initialStoreState: { mentionableUsersCache: { 'app-1': [] } },
  })
  const replyInput = screen.getByRole('textbox')
  await expect.element(replyInput).toHaveFocus()
  await userEvent.tab({ shift: true })
  const trigger = screen.getByRole('button', {
    name: 'workflowComments.comments.aria.replyActions',
  })
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
  const confirmation = screen.getByRole('alertdialog', {
    name: 'workflowComments.comments.actions.deleteReply',
  })
  await expect.element(confirmation).toBeVisible()
  await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
  expect(onDelete).not.toHaveBeenCalled()
  await confirmation.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(confirmation).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  expect(trigger.element().checkVisibility({ checkOpacity: true })).toBe(true)
})
