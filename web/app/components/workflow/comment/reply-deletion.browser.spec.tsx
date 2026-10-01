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

function Fixture({
  onDelete,
  detail = comment,
  loading = false,
}: {
  onDelete: (id: string) => Promise<void> | void
  detail?: WorkflowCommentDetail
  loading?: boolean
}) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<p>Loading profile</p>}>
        <button type="button">Outside thread</button>
        <div id="workflow-container" style={{ position: 'relative', width: 1000, height: 650 }}>
          <CommentThread
            comment={detail}
            loading={loading}
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

function createPendingRequest() {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

it('keeps reply deletion pending through refetch and restores focus to the input after the reply disappears', async () => {
  const deletion = createPendingRequest()
  const refetch = createPendingRequest()
  const onDelete = vi.fn()

  function DeletionFixture() {
    const [detail, setDetail] = useState(comment)
    const [loading, setLoading] = useState(false)
    return (
      <Fixture
        detail={detail}
        loading={loading}
        onDelete={async (id) => {
          setLoading(true)
          onDelete(id)
          await deletion.promise
          await refetch.promise
          setDetail({ ...comment, replies: [] })
          setLoading(false)
        }}
      />
    )
  }

  const screen = await render(<DeletionFixture />)
  const replyInput = screen.getByRole('textbox')
  await expect.element(replyInput).toHaveFocus()
  await userEvent.tab({ shift: true })
  await userEvent.keyboard('{ArrowDown}{End}{Enter}')
  const confirmation = screen.getByRole('alertdialog')
  const confirm = confirmation.getByRole('button', { name: 'common.operation.delete' })
  const cancel = confirmation.getByRole('button', { name: 'common.operation.cancel' })
  await confirm.click()
  await expect.element(confirm).toBeDisabled()
  await expect.element(cancel).toBeDisabled()
  await userEvent.keyboard('{Enter}{Escape}')
  await expect.element(confirmation).toBeVisible()
  expect(onDelete).toHaveBeenCalledExactlyOnceWith('reply')

  deletion.resolve()
  await expect.element(confirmation).toBeVisible()
  await expect.element(confirm).toBeDisabled()
  refetch.resolve()
  await expect.element(confirmation).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'workflowComments.comments.aria.replyActions' }))
    .not.toBeInTheDocument()
  await expect.element(replyInput).toHaveFocus()
})
