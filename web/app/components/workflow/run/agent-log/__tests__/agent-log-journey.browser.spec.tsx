import type { AgentLogItemWithChildren, NodeTracing } from '@/types/workflow'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createNodeTracing } from '@/app/components/workflow/__tests__/fixtures'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { BlockEnum } from '../../../types'
import { useLogs } from '../../hooks'
import { AgentLogTrigger } from '../agent-log-trigger'
import AgentResultPanel from '../agent-result-panel'

// boundary: Monaco's worker/asset runtime is external; keep Dify's read-only editor and JSON serialization real.
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, options }: { value: string; options: { readOnly: boolean } }) => (
    <textarea aria-label="Log data" value={value} readOnly={options.readOnly} />
  ),
  loader: { config: () => {} },
}))

const logItem = (
  message_id: string,
  label: string,
  children: AgentLogItemWithChildren[] = [],
  overrides: Partial<AgentLogItemWithChildren> = {},
): AgentLogItemWithChildren => ({
  message_id,
  label,
  children,
  status: 'succeeded',
  node_execution_id: 'exec-1',
  node_id: 'node-1',
  data: { thought: 'inspect data' },
  metadata: { elapsed_time: 1.234 },
  ...overrides,
})

const trace = (overrides: Partial<NodeTracing> = {}) =>
  createNodeTracing({
    node_type: BlockEnum.Agent,
    execution_metadata: {
      total_tokens: 0,
      total_price: 0,
      currency: 'USD',
      tool_info: { agent_strategy: 'Plan and execute' },
    },
    ...overrides,
  })

// Compose the run viewer's public commands and surfaces. The production hook owns the
// breadcrumb stack and log map; the test never updates them or replaces their subscriptions.
function LogViewer({ nodeInfo }: { nodeInfo: NodeTracing }) {
  const logs = useLogs()
  return logs.showSpecialResultPanel ? (
    <AgentResultPanel
      agentOrToolLogItemStack={logs.agentOrToolLogItemStack}
      agentOrToolLogListMap={logs.agentOrToolLogListMap}
      onShowAgentOrToolLog={logs.handleShowAgentOrToolLog}
    />
  ) : (
    <AgentLogTrigger nodeInfo={nodeInfo} onShowAgentOrToolLog={logs.handleShowAgentOrToolLog} />
  )
}

async function setup(nodeInfo: NodeTracing) {
  onTestFinished(guardUnexpectedFetch())
  const { queryClient, wrapper: Providers } = createConsoleQueryWrapper()
  onTestFinished(() => queryClient.clear())
  return render(
    <Providers>
      <div style={{ width: 480 }}>
        <LogViewer nodeInfo={nodeInfo} />
      </div>
    </Providers>,
  )
}

it('opens nested action logs and returns through the overflow breadcrumb, strategy and agent', async () => {
  const leaf = logItem('leaf', 'Tool Call')
  const child = logItem('child', 'Child Tool', [leaf], { hasCircle: true })
  const planner = logItem('planner', 'Planner', [child])
  const screen = await setup(trace({ agentLog: [planner] }))
  await screen.getByRole('button', { name: /Plan and execute/ }).click()
  await expect.element(screen.getByText('Planner', { exact: true })).toBeVisible()
  await screen.getByText('Planner', { exact: true }).click()
  await screen.getByRole('button', { name: '1 Action Logs' }).click()
  await expect.element(screen.getByText('Child Tool', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('Planner', { exact: true })).toBeVisible()

  await screen.getByText('Child Tool', { exact: true }).click()
  const actions = screen.getByRole('button', { name: '1 Action Logs' })
  await expect.element(actions).toBeVisible()
  actions.element().focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByText('Tool Call', { exact: true })).toBeVisible()
  await expect.element(screen.getByRole('status')).toHaveTextContent('runLog.circularInvocationTip')

  const more = screen.getByRole('button', { name: 'common.operation.more' })
  await more.click()
  const intermediate = screen.getByRole('menuitem', { name: 'Planner', exact: true })
  await expect.element(intermediate).toBeVisible()
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(intermediate).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
  await expect.element(screen.getByText('Child Tool', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('Tool Call', { exact: true })).not.toBeInTheDocument()
  await expect.element(screen.getByRole('status')).not.toBeInTheDocument()

  await screen.getByRole('button', { name: 'workflowAgent.nodes.agent.strategy.label' }).click()
  await expect.element(screen.getByText('Planner', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('Child Tool', { exact: true })).not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'AGENT', exact: true }).click()
  await expect.element(screen.getByRole('button', { name: /Plan and execute/ })).toBeVisible()
  await expect.element(screen.getByRole('navigation')).not.toBeInTheDocument()
})

it('expands and collapses readable log data together with its nested-action control', async () => {
  const planner = logItem('planner', 'Planner', [logItem('child', 'Tool Call')])
  const screen = await setup(trace({ agentLog: [planner] }))
  await screen.getByRole('button', { name: /Plan and execute/ }).click()
  await expect.element(screen.getByText('1.234s', { exact: true })).toBeVisible()
  const data = screen.getByRole('textbox', { name: 'Log data' })
  const actions = screen.getByRole('button', { name: '1 Action Logs' })
  await expect.element(data).not.toBeInTheDocument()
  await expect.element(actions).not.toBeInTheDocument()
  await screen.getByText('Planner', { exact: true }).click()
  await expect.element(data).toHaveValue('{\n  "thought": "inspect data"\n}')
  await expect.element(data).toHaveAttribute('readonly')
  await expect.element(actions).toBeVisible()
  await screen.getByText('Planner', { exact: true }).click()
  await expect.element(data).not.toBeInTheDocument()
  await expect.element(actions).not.toBeInTheDocument()
})

it('opens an empty strategy view when a run has no strategy metadata or action logs', async () => {
  const screen = await setup(
    trace({
      agentLog: undefined,
      execution_metadata: { total_tokens: 0, total_price: 0, currency: 'USD' },
    }),
  )
  const trigger = screen.getByRole('button', { name: /runLog.detail/ })
  await trigger.click()
  await expect.element(screen.getByRole('navigation')).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: '1 Action Logs' }))
    .not.toBeInTheDocument()
  await expect.element(screen.getByRole('textbox')).not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'AGENT', exact: true }).click()
  await expect.element(trigger).toBeVisible()
})
