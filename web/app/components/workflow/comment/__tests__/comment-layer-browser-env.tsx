import ReactFlow from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { renderWorkflowBrowserComponent as render } from '../../__tests__/workflow-browser-test-env'
import { WorkflowCommentLayer } from '../workflow-comment-layer'
import { author } from './comment-layer-fake-server'
import { seedMentionableUsers } from './comment-query-data'
import 'reactflow/dist/style.css'

// The real comment layer on a real canvas, and what a person finds on it.

export async function renderLayer({
  hideResolved = false,
  queryClient = createConsoleQueryWrapper({
    accountProfile: { id: author.id, name: author.name, avatar_url: null },
  }).queryClient,
} = {}) {
  await page.viewport(1200, 800)
  seedMentionableUsers(queryClient, [])
  const screen = await render(
    <div
      id="workflow-container"
      className="isolate"
      style={{ position: 'relative', width: 1100, height: 700 }}
    >
      <WorkflowCommentLayer />
      <ReactFlow nodes={[]} />
    </div>,
    {
      queryClient,
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow', collaborationEnabled: true },
      initialStoreState: { showUserComments: true, showResolvedComments: !hideResolved },
    },
  )
  return { ...screen, queryClient }
}
type Screen = Awaited<ReturnType<typeof renderLayer>>

export const markers = (screen: Screen) =>
  screen.getByRole('button', { name: `workflow.keyboard.openComment:{"name":"${author.name}"}` })
export const thread = (screen: Screen) =>
  screen.getByRole('dialog', { name: 'workflowComments.comments.panelTitle' })
export const replyBox = (screen: Screen) =>
  screen.getByPlaceholder('workflowComments.comments.placeholder.reply')

export const pointerToEmptyCanvas = () =>
  page
    .elementLocator(document.querySelector('.react-flow__pane')!)
    .hover({ position: { x: 1000, y: 600 } })
// The pointer may still rest where an earlier test left it, with a hover card over the marker.
export async function openThread(screen: Screen, index = 0) {
  await expect.element(markers(screen).nth(index)).toBeVisible()
  await pointerToEmptyCanvas()
  await markers(screen).nth(index).click()
  await expect.element(thread(screen)).toBeVisible()
}
export async function sendReply(screen: Screen, text: string) {
  await replyBox(screen).fill(text)
  await userEvent.keyboard('{Enter}')
}
