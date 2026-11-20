import { page } from 'vite-plus/test/browser'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { renderWorkflowBrowserComponent as render } from '../__tests__/workflow-browser-test-env'
import { CommentInput } from './comment-input'

const renderDraft = async (x: number) => {
  await page.viewport(1000, 600)
  const { queryClient } = createConsoleQueryWrapper({
    accountProfile: { id: 'author', name: 'Alice', avatar_url: null },
  })
  const screen = await render(
    <div style={{ position: 'relative', width: 900, height: 500 }}>
      <CommentInput position={{ x, y: 200 }} onSubmit={() => {}} onCancel={() => {}} />
    </div>,
    {
      queryClient,
      initialStoreState: {
        mentionableUsersCache: { 'app-1': [] },
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
  return { marker, box }
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
