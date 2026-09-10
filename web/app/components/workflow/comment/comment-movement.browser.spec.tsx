import type { WorkflowCommentList } from './types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Suspense, useState } from 'react'
import ReactFlow, { ReactFlowProvider } from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { CommentIcon } from './comment-icon'
import { CommentInput } from './comment-input'
import 'reactflow/dist/style.css'

vi.mock('@/features/account-profile/client', () => ({
  userProfileQueryOptions: () => ({
    queryKey: ['profile'],
    queryFn: async () => ({ profile: { id: 'author', name: 'Alice', avatar_url: null } }),
  }),
}))
vi.mock('./comment-preview', () => ({ default: () => null }))
vi.mock('./mention-input', () => ({ MentionInput: () => <textarea aria-label="Comment text" /> }))

const comment: WorkflowCommentList = {
  id: 'comment',
  content: 'Comment',
  created_by: 'author',
  position_x: 100,
  position_y: 100,
  created_by_account: { id: 'author', name: 'Alice', email: 'alice@example.com', avatar_url: null },
  created_at: 1,
  updated_at: 1,
  resolved: false,
  mention_count: 0,
  reply_count: 0,
  participants: [],
}

function Fixture({ draft = false }: { draft?: boolean }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
  const [current, setCurrent] = useState(comment)
  const [position, setPosition] = useState({ x: 100, y: 100 })
  const [opened, setOpened] = useState(false)
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<p>Loading profile</p>}>
        <ReactFlowProvider>
          <button type="button">Before canvas</button>
          <div
            id="workflow-container"
            role="group"
            aria-label="Canvas"
            style={{ position: 'relative', width: 800, height: 600 }}
          >
            {draft ? (
              <CommentInput
                position={position}
                onSubmit={() => {}}
                onCancel={() => {}}
                onPositionChange={(next) => setPosition({ x: next.elementX, y: next.elementY })}
              />
            ) : (
              <CommentIcon
                comment={current}
                onClick={() => setOpened(true)}
                onPositionUpdate={(next) =>
                  setCurrent((value) => ({ ...value, position_x: next.x, position_y: next.y }))
                }
              />
            )}
            <ReactFlow nodes={[]} />
            {opened && <p role="status">Comment opened</p>}
          </div>
        </ReactFlowProvider>
      </Suspense>
    </QueryClientProvider>
  )
}

it('keeps an authored comment focusable and draggable after adding keyboard movement', async () => {
  // Browser-owned: real pointer capture, marker hit testing, and native button activation.
  await page.viewport(1000, 800)
  const screen = await render(<Fixture />)
  const marker = screen.getByRole('button', { name: /workflow.keyboard.openComment/ })
  await expect.element(marker).toBeVisible()
  await screen.getByRole('button', { name: 'Before canvas' }).click()
  await userEvent.tab()
  await expect.element(marker).toHaveFocus()
  const initial = marker.element().getBoundingClientRect()
  await userEvent.keyboard('{ArrowRight}')
  await expect.poll(() => marker.element().getBoundingClientRect().x).toBe(initial.x + 5)
  await userEvent.dragAndDrop(marker, screen.getByRole('group', { name: 'Canvas' }), {
    targetPosition: { x: 300, y: 250 },
  })
  expect(marker.element().getBoundingClientRect().x).toBeGreaterThan(initial.x + 5)
  await expect.element(screen.getByRole('status')).not.toBeInTheDocument()
  await marker.click()
  await expect.element(screen.getByRole('status')).toHaveTextContent('Comment opened')
})

it('preserves draft mouse dragging and lets keyboard users move the same handle', async () => {
  // Browser-owned: native document pointer events and geometry of the positioned draft.
  await page.viewport(1000, 800)
  const screen = await render(<Fixture draft />)
  const handle = screen.getByRole('button', { name: 'workflow.keyboard.moveDraftComment' })
  await expect.element(handle).toBeVisible()
  const initial = handle.element().getBoundingClientRect()
  await userEvent.dragAndDrop(handle, screen.getByRole('group', { name: 'Canvas' }), {
    targetPosition: { x: 300, y: 250 },
  })
  expect(handle.element().getBoundingClientRect().x).toBeGreaterThan(initial.x)
  await screen.getByRole('button', { name: 'Before canvas' }).click()
  await userEvent.tab()
  await expect.element(handle).toHaveFocus()
  const dragged = handle.element().getBoundingClientRect()
  await userEvent.keyboard('{Enter}{ArrowRight}{Shift>}{ArrowDown}{/Shift}{Enter}')
  await expect.poll(() => handle.element().getBoundingClientRect().x).toBe(dragged.x + 5)
  expect(handle.element().getBoundingClientRect().y).toBe(dragged.y + 20)
  await expect.element(handle).toHaveAttribute('aria-pressed', 'false')
})
