import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNodeTracing } from '@/app/components/workflow/__tests__/fixtures'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createWorkflowProcessFixture } from '@/test/fixtures/workflow-process'
import WorkflowProcessItem from '../workflow-process'

const data = createWorkflowProcessFixture({
  tracing: [
    createNodeTracing({ node_id: 'start', title: 'Start' }),
    createNodeTracing({ node_id: 'end', title: 'End' }),
  ],
})

it('opens real tracing details with the keyboard and collapses back to the latest node', async () => {
  const user = userEvent.setup()
  render(<WorkflowProcessItem data={data} />)
  const header = screen.getByRole('button', { name: /End/ })
  expect(header).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('Start')).not.toBeInTheDocument()
  header.focus()
  await user.keyboard('{Enter}')
  expect(screen.getByText('Start')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /workflowProcess/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await user.keyboard(' ')
  expect(screen.queryByText('Start')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /End/ })).toHaveAttribute('aria-expanded', 'false')
})

it('honors an external expand change and exposes an error without tracing details', () => {
  const failed = createWorkflowProcessFixture({
    status: WorkflowRunningStatus.Failed,
    error: 'Invalid upload file',
  })
  const { rerender } = render(<WorkflowProcessItem data={failed} expand={false} />)
  expect(screen.getByRole('button', { name: /Invalid upload file/ })).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  rerender(<WorkflowProcessItem data={failed} expand />)
  expect(screen.getByRole('alert')).toHaveTextContent('Invalid upload file')
  expect(screen.getByRole('button', { name: /workflowProcess/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
})

it('localizes a KnowledgeFS permissions rejection in the collapsed and expanded states', async () => {
  const user = userEvent.setup()
  render(
    <WorkflowProcessItem
      data={createWorkflowProcessFixture({
        status: WorkflowRunningStatus.Failed,
        error:
          '[knowledge_fs_authorization_not_ready] KnowledgeFS Space space-a permissions are not ready',
      })}
      expand={false}
    />,
  )
  const localized = 'workflow.nodes.knowledgeRetrievalV2.errors.permissionsNotReady'
  expect(screen.getByText(localized)).toBeInTheDocument()
  expect(screen.queryByText(/KnowledgeFS Space space-a/)).not.toBeInTheDocument()
  await user.click(screen.getByRole('button'))
  expect(screen.getByRole('alert')).toHaveTextContent(localized)
})

it('hides the process in readonly chat', () => {
  const { container } = render(<WorkflowProcessItem data={data} readonly />)
  expect(container).toBeEmptyDOMElement()
})

it.each([
  [WorkflowRunningStatus.Running, 'workflowProcessRunning'],
  [WorkflowRunningStatus.Succeeded, 'workflowProcessSucceeded'],
  [WorkflowRunningStatus.Failed, 'workflowProcessFailed'],
  [WorkflowRunningStatus.Stopped, 'workflowProcessFailed'],
  [WorkflowRunningStatus.Paused, 'workflowProcessPaused'],
] as const)('announces workflow status %s', (status, label) => {
  render(<WorkflowProcessItem data={{ ...data, status }} />)
  expect(screen.getByRole('img', { name: `workflow.common.${label}` })).toBeInTheDocument()
})
