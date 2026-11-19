import { page, userEvent } from 'vite-plus/test/browser'
import { createNodeTracing } from '@/app/components/workflow/__tests__/fixtures'
import { BlockEnum, WorkflowRunningStatus } from '@/app/components/workflow/types'
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

const externalWaitNode = createNodeTracing({
  node_id: 'external-agent',
  node_type: BlockEnum.Agent,
  title: 'External agent',
  status: 'paused',
  process_data: null,
  execution_metadata: undefined,
  index: 1,
})
const humanWaitNode = createNodeTracing({
  node_id: 'human-input',
  node_type: BlockEnum.HumanInput,
  title: 'Human approval',
  status: 'paused',
  index: 2,
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

it('shows an external-only wait as running and updates when the workflow pauses for a person', async () => {
  const previousExecution = {
    ...externalWaitNode,
    id: 'previous-external-execution',
    title: 'Earlier external agent',
    index: 0,
  }
  const waiting = createWorkflowProcessFixture({
    status: WorkflowRunningStatus.Paused,
    pauseReasons: [
      {
        TYPE: 'external_wait',
        node_id: externalWaitNode.node_id,
        execution_id: externalWaitNode.id,
      },
    ],
    tracing: [previousExecution, externalWaitNode],
  })
  const screen = await render(<WorkflowProcessItem data={waiting} />)
  await expect
    .element(screen.getByRole('img', { name: 'Workflow Process running', exact: true }))
    .toBeVisible()
  await screen.getByRole('button', { name: /External agent/ }).click()
  await expect
    .element(screen.getByRole('button', { name: 'External agent Running', exact: true }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('img', { name: 'Workflow Process paused', exact: true }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'Earlier external agent Paused', exact: true }))
    .toBeVisible()
  expect(waiting.status).toBe(WorkflowRunningStatus.Paused)
  expect(waiting.tracing.map((node) => node.status)).toEqual(['paused', 'paused'])

  await screen.rerender(
    <WorkflowProcessItem
      data={{
        ...waiting,
        pauseReasons: [
          {
            TYPE: 'human_input_required',
            node_id: humanWaitNode.node_id,
            execution_id: humanWaitNode.id,
          },
        ],
        tracing: [{ ...externalWaitNode, status: 'succeeded' }, humanWaitNode],
      }}
    />,
  )
  await expect
    .element(screen.getByRole('img', { name: 'Workflow Process paused', exact: true }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: /External agent.*Success/ }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'Human approval Paused', exact: true }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('img', { name: 'Workflow Process running', exact: true }))
    .not.toBeInTheDocument()
})

it('keeps mixed external and human pauses paused while the external node displays running', async () => {
  const screen = await render(
    <WorkflowProcessItem
      data={createWorkflowProcessFixture({
        status: WorkflowRunningStatus.Paused,
        pauseReasons: [
          {
            TYPE: 'external_wait',
            node_id: externalWaitNode.node_id,
            execution_id: externalWaitNode.id,
          },
          {
            TYPE: 'hitl_required',
            node_id: humanWaitNode.node_id,
            execution_id: humanWaitNode.id,
          },
        ],
        tracing: [externalWaitNode, humanWaitNode],
      })}
      expand
    />,
  )
  await expect
    .element(screen.getByRole('img', { name: 'Workflow Process paused', exact: true }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'External agent Running', exact: true }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'Human approval Paused', exact: true }))
    .toBeVisible()
})

it.each([
  ['missing', undefined],
  ['empty', []],
  ['unrecognized', [{ TYPE: 'future_pause_reason' }]],
] as const)('keeps a workflow paused for %s pause reasons', async (_, pauseReasons) => {
  const screen = await render(
    <WorkflowProcessItem
      data={createWorkflowProcessFixture({
        status: WorkflowRunningStatus.Paused,
        pauseReasons: pauseReasons ? [...pauseReasons] : undefined,
        tracing: [
          {
            ...externalWaitNode,
            process_data: { external_invocation_id: 'previous-invocation' },
          },
        ],
      })}
      expand
    />,
  )
  await expect
    .element(screen.getByRole('img', { name: 'Workflow Process paused', exact: true }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('img', { name: 'Workflow Process running', exact: true }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'External agent Paused', exact: true }))
    .toBeVisible()
})

it.each([
  [WorkflowRunningStatus.Succeeded, 'Workflow Process succeeded'],
  [WorkflowRunningStatus.Failed, 'Workflow Process failed'],
  [WorkflowRunningStatus.Stopped, 'Workflow Process failed'],
] as const)(
  'does not show a leftover paused external execution as running after workflow status %s',
  async (status, workflowLabel) => {
    const screen = await render(
      <WorkflowProcessItem
        data={createWorkflowProcessFixture({
          status,
          pauseReasons: undefined,
          tracing: [
            {
              ...externalWaitNode,
              process_data: { external_invocation_id: 'previous-invocation' },
            },
          ],
        })}
        expand
      />,
    )
    await expect
      .element(screen.getByRole('img', { name: workflowLabel, exact: true }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'External agent Paused', exact: true }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'External agent Running', exact: true }))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('img', { name: 'Workflow Process running', exact: true }))
      .not.toBeInTheDocument()
  },
)
