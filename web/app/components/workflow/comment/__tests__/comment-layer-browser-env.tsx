import { DirectionProvider } from '@langgenius/dify-ui/direction-provider'
import { page, userEvent } from 'vite-plus/test/browser'
import { TEST_APP_ID } from '@/test/console/ids'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { renderWorkflowBrowserComponent as render } from '../../__tests__/workflow-browser-test-env'
import CommentManager from '../../comment-manager'
import { WorkflowCanvas } from '../../shortcuts/workflow-canvas'
import { ControlMode } from '../../types'
import { WorkflowCommentLayer } from '../workflow-comment-layer'
import { author } from './comment-layer-fake-server'
import { seedMentionableUsers } from './comment-query-data'
import 'reactflow/dist/style.css'

// The real comment layer on a real canvas, and what a person finds on it.

export async function renderLayer({
  hideResolved = false,
  controlMode = ControlMode.Pointer as ControlMode,
  direction = 'ltr' as 'ltr' | 'rtl',
  avatarUrl = null as string | null,
  queryClient = createConsoleQueryWrapper({
    accountProfile: { id: author.id, name: author.name, avatar_url: avatarUrl },
    appDslVersion: '0.6.0',
  }).queryClient,
} = {}) {
  await page.viewport(1200, 800)
  seedMentionableUsers(queryClient, [], TEST_APP_ID)
  const screen = await render(
    <DirectionProvider direction={direction}>
      <div
        id="workflow-container"
        dir={direction}
        className="isolate"
        style={{ position: 'relative', width: 1100, height: 700 }}
      >
        <CommentManager />
        <WorkflowCanvas nodes={[]} />
        <WorkflowCommentLayer />
      </div>
    </DirectionProvider>,
    {
      queryClient,
      resource: { kind: 'app', appId: TEST_APP_ID, mode: 'workflow', collaborationEnabled: true },
      initialStoreState: {
        controlMode,
        showUserComments: true,
        showResolvedComments: !hideResolved,
      },
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
// A hovered marker is covered by its hover card, which opens the thread too; the keyboard
// reaches the marker itself whatever the pointer does.
export async function openThread(screen: Screen, index = 0) {
  await expect.element(markers(screen).nth(index)).toBeVisible()
  markers(screen).nth(index).element().focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(thread(screen)).toBeVisible()
}
export async function sendReply(screen: Screen, text: string) {
  await replyBox(screen).fill(text)
  await userEvent.keyboard('{Enter}')
}
