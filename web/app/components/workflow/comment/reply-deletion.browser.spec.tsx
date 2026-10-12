import type { WorkflowCommentDetail } from './types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Suspense, useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { CommentThread } from './thread'

vi.mock('@/next/navigation', () => ({ useParams: () => ({ appId: 'app-1' }) }))
vi.mock('reactflow', () => ({
  useReactFlow: () => ({ flowToScreenPosition: (position: { x: number; y: number }) => position }),
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
}))
const store = vi.hoisted(() => ({
  mentionableUsersCache: { 'app-1': [] },
  setCommentPreviewHovering: () => {},
}))
vi.mock('../store', () => ({
  useStore: (selector: (state: typeof store) => unknown) => selector(store),
  useWorkflowStore: () => ({ getState: () => store }),
}))
vi.mock('@/features/account-profile/client', () => ({
  userProfileQueryOptions: () => ({
    queryKey: ['profile'],
    queryFn: async () => ({ profile: { id: 'author', name: 'Alice', avatar_url: null } }),
  }),
}))

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
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<p>Loading profile</p>}>
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
      </Suspense>
    </QueryClientProvider>
  )
}

it('lets keyboard users request reply deletion and returns focus to reply actions when cancelled', async () => {
  // Native Tab and CSS visibility expose regressions hidden by DOM-only tests.
  await page.viewport(1200, 800)
  const onDelete = vi.fn()
  const screen = await render(<Fixture onDelete={onDelete} />)
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
