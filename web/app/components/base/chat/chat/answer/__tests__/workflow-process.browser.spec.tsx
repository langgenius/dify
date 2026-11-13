import { page, userEvent } from 'vite-plus/test/browser'
import { createNodeTracing } from '@/app/components/workflow/__tests__/fixtures'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { createWorkflowProcessFixture } from '@/test/fixtures/workflow-process'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { renderChat as render } from '../../__tests__/chat-browser-test-env'
import WorkflowProcessItem from '../workflow-process'

vi.unmock('react-i18next')

beforeEach(async () => {
  await page.viewport(800, 600)
  onTestFinished(guardUnexpectedFetch())
})

const data = createWorkflowProcessFixture({
  tracing: [
    createNodeTracing({ node_id: 'start', title: 'Start' }),
    createNodeTracing({ node_id: 'end', title: 'End' }),
  ],
})

it('opens real tracing details with the keyboard and collapses back to the latest node', async () => {
  const screen = await render(<WorkflowProcessItem data={data} />)
  const header = screen.getByRole('button', { name: /End/ })
  await expect.element(header).toHaveAttribute('aria-expanded', 'false')
  await expect.element(screen.getByText('Start')).not.toBeInTheDocument()
  await userEvent.tab()
  await expect.element(header).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByText('Start')).toBeVisible()
  await expect.element(screen.getByRole('button', { name: /Workflow Process/ })).toHaveFocus()
  await expect
    .element(screen.getByRole('button', { name: /Workflow Process/ }))
    .toHaveAttribute('aria-expanded', 'true')
  await userEvent.keyboard('{Space}')
  await expect.element(screen.getByText('Start')).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: /End/ }))
    .toHaveAttribute('aria-expanded', 'false')
})

it('honors an external expand change and exposes an error without tracing details', async () => {
  const failed = createWorkflowProcessFixture({
    status: WorkflowRunningStatus.Failed,
    error: 'Invalid upload file',
  })
  const screen = await render(<WorkflowProcessItem data={failed} expand={false} />)
  await expect.element(screen.getByRole('button', { name: /Invalid upload file/ })).toBeVisible()
  await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
  await screen.rerender(<WorkflowProcessItem data={failed} expand />)
  await expect.element(screen.getByRole('alert')).toHaveTextContent('Invalid upload file')
  await expect
    .element(screen.getByRole('button', { name: /Workflow Process/ }))
    .toHaveAttribute('aria-expanded', 'true')
})

it('localizes a KnowledgeFS permissions rejection in the collapsed and expanded states', async () => {
  const screen = await render(
    <WorkflowProcessItem
      data={createWorkflowProcessFixture({
        status: WorkflowRunningStatus.Failed,
        error:
          '[knowledge_fs_authorization_not_ready] KnowledgeFS Space space-a permissions are not ready',
      })}
      expand={false}
    />,
  )
  const localized =
    'Permissions for this Agent Knowledge Base are not ready. Ask a workspace owner to finish the permission setup.'
  await expect.element(screen.getByText(localized)).toBeVisible()
  await expect.element(screen.getByText(/KnowledgeFS Space space-a/)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button'))
  await expect.element(screen.getByRole('alert')).toHaveTextContent(localized)
})

it('removes the process when the conversation becomes readonly', async () => {
  const screen = await render(<WorkflowProcessItem data={data} />)
  await expect.element(screen.getByRole('button', { name: /End/ })).toBeVisible()
  await screen.rerender(<WorkflowProcessItem data={data} readonly />)
  await expect.element(screen.getByRole('button')).not.toBeInTheDocument()
})

it.each([
  [WorkflowRunningStatus.Running, 'Workflow Process running'],
  [WorkflowRunningStatus.Succeeded, 'Workflow Process succeeded'],
  [WorkflowRunningStatus.Failed, 'Workflow Process failed'],
  [WorkflowRunningStatus.Stopped, 'Workflow Process failed'],
  [WorkflowRunningStatus.Paused, 'Workflow Process paused'],
] as const)('announces workflow status %s', async (status, label) => {
  const screen = await render(<WorkflowProcessItem data={{ ...data, status }} />)
  await expect.element(screen.getByRole('img', { name: label })).toBeVisible()
})
