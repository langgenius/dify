import { page } from 'vite-plus/test/browser'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { renderWorkflowBrowserComponent as render } from '../__tests__/workflow-browser-test-env'
import { seedMentionableUsers } from './__tests__/comment-query-data'
import { CommentInput } from './comment-input'

const renderDraft = async (x: number, y = 200) => {
  await page.viewport(1000, 600)
  const { queryClient } = createConsoleQueryWrapper({
    accountProfile: { id: 'author', name: 'Alice', avatar_url: null },
  })
  seedMentionableUsers(queryClient, [])
  const screen = await render(
    <div style={{ position: 'relative', width: 900, height: 500 }}>
      <CommentInput position={{ x, y }} onSubmit={() => {}} onCancel={() => {}} />
    </div>,
    {
      queryClient,
      initialStoreState: {
        workflowCanvasWidth: 900,
        rightPanelWidth: 400,
      },
    },
  )
  const marker = screen
    .getByRole('button', { name: 'workflow.keyboard.moveDraftComment' })
    .element()
    .getBoundingClientRect()
  const box = screen.getByRole('textbox').element().closest('.rounded-xl')!.getBoundingClientRect()
  const canvas = screen.container.firstElementChild!.getBoundingClientRect()
  return { marker, box, canvas }
}

it('places the draft box to the right of its marker tip when there is room', async () => {
  const { marker, box } = await renderDraft(40)
  expect(box.left).toBeGreaterThan(marker.right)
})

it('opens the draft box to the left when an open side panel would cover it', async () => {
  const { marker, box } = await renderDraft(400)
  expect(box.right).toBeLessThan(marker.left)
  expect(box.right).toBeLessThanOrEqual(900 - 400)
})

it('keeps the draft box inside the canvas when the comment sits at its top edge', async () => {
  const { marker, box, canvas } = await renderDraft(40, 30)
  expect(box.top).toBeGreaterThanOrEqual(canvas.top)
  expect(marker.bottom - canvas.top).toBeCloseTo(30, 0)
})
