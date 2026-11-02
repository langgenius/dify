import type { ReactNode } from 'react'
import type { SyncDraftCallback } from '@/app/components/workflow/hooks-store'
import type { Shape as HooksStoreShape } from '@/app/components/workflow/hooks-store/store'
import type { HumanInputNodeType } from '@/app/components/workflow/nodes/human-input/types'
import type { Node } from '@/app/components/workflow/types'
import { ORPCError } from '@orpc/client'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { use } from 'react'
import { useStoreApi } from 'reactflow'
import { createDefaultFormInputByType } from '@/app/components/workflow/nodes/human-input/types'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createEdge, createNode } from '../../../../__tests__/fixtures'
import { renderWorkflowCanvasHook } from '../../../../__tests__/workflow-test-env'
import { useNodeDataUpdate } from '../../../../hooks/use-node-data-update'
import { HumanInputMigrationContext } from '../context'
import HumanInputMigrationProvider from '../provider'

const runtime = vi.hoisted(() => ({ releaseEnabled: true }))
const postMigration = vi.hoisted(() => vi.fn())
vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  get ENABLE_HITL_IM() {
    return runtime.releaseEnabled
  },
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.humanInput.v2.nodeDataMigration.post': postMigration,
    }),
  }
})

const createLegacyNode = (
  unsupported = false,
  id = 'legacy-human-input',
  inputs: HumanInputNodeType['inputs'] = [],
): Node<HumanInputNodeType> => ({
  id,
  type: 'custom',
  position: { x: 100, y: 100 },
  data: {
    type: BlockEnum.HumanInput,
    title: 'Approval',
    desc: '',
    delivery_methods: [
      {
        id: 'method',
        type: unsupported ? 'slack' : 'webapp',
        enabled: true,
      },
    ],
    form_content: '',
    inputs,
    user_actions: [],
    timeout: 3,
    timeout_unit: 'day',
  },
})

const PolicyProbe = () => {
  const migration = use(HumanInputMigrationContext)
  return (
    <div>{migration?.policy.canAddHumanInputV2 ? 'insertion-enabled' : 'insertion-blocked'}</div>
  )
}

const migrationResponse = (nodes: Node[]) => ({
  data: nodes
    .filter((node) => node.data.type === BlockEnum.HumanInput)
    .map((node) => ({
      node_id: node.id,
      node_data: {
        title: node.data.title,
        type: 'human-input',
        version: '2',
        form_content: '',
        inputs: 'inputs' in node.data ? node.data.inputs : [],
        user_actions: [],
        timeout: 3,
        timeout_unit: 'day',
        recipients_spec: [{ type: 'initiator' }],
        message_template: { subject: '', body: '' },
        debug_mode: { enabled: false, channels: [] },
      },
    })),
})

function setup({
  nodes = [createLegacyNode()],
  canEdit = true,
  sync = async () => ({ hash: 'saved-draft', updatedAt: 123 }),
}: {
  nodes?: Node[]
  canEdit?: boolean
  sync?: HooksStoreShape['doSyncWorkflowDraft']
} = {}) {
  const edges = nodes.length > 1 ? [createEdge({ source: nodes[0]!.id, target: nodes[1]!.id })] : []
  const { queryClient } = createConsoleQueryWrapper()
  seedModelProviderQueries(queryClient)
  postMigration.mockResolvedValue(migrationResponse(nodes))
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <HumanInputMigrationProvider canEdit={canEdit}>
      <div>Original workflow canvas</div>
      <PolicyProbe />
      {children}
    </HumanInputMigrationProvider>
  )
  const view = renderWorkflowCanvasHook(() => ({ canvas: useStoreApi(), ...useNodeDataUpdate() }), {
    nodes,
    edges,
    queryClient,
    wrapper: Wrapper,
    historyStore: { nodes, edges },
    hooksStoreProps: { doSyncWorkflowDraft: sync },
  })
  const graph = () => ({
    nodes: view.result.current.canvas.getState().getNodes(),
    edges: view.result.current.canvas.getState().edges,
  })
  return { ...view, graph }
}

const openDialog = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(
    screen.getByRole('button', { name: 'workflow.nodes.humanInputMigration.action.migrateNow' }),
  )
const confirmMigration = async (user: ReturnType<typeof userEvent.setup>) => {
  await openDialog(user)
  await user.click(
    screen.getByRole('button', { name: 'workflow.nodes.humanInputMigration.action.migrate' }),
  )
}

beforeEach(() => {
  runtime.releaseEnabled = true
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})
const newUser = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

it('keeps the original graph without migration UI or requests when the release gate is off', () => {
  runtime.releaseEnabled = false
  const view = setup()
  expect(screen.getByText('Original workflow canvas')).toBeInTheDocument()
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(view.graph().nodes[0]!.data).toEqual(createLegacyNode().data)
  expect(postMigration).not.toHaveBeenCalled()
})

it('migrates the real graph through one shared dialog and updates the insertion policy', async () => {
  const user = newUser()
  const unrelated = createNode({ id: 'unrelated' })
  const view = setup({ nodes: [createLegacyNode(), unrelated] })
  const edges = view.graph().edges
  expect(screen.getByText('insertion-blocked')).toBeInTheDocument()
  expect(
    screen.getByRole('complementary', {
      name: 'workflow.nodes.humanInputMigration.banner.ariaLabel',
    }),
  ).toBeInTheDocument()
  await confirmMigration(user)
  expect(await screen.findByText('insertion-enabled')).toBeInTheDocument()
  expect(view.graph().nodes[0]!.data).toMatchObject({
    version: '2',
    recipients_spec: [{ type: 'initiator' }],
  })
  expect(view.graph().nodes[0]!.data).not.toHaveProperty('delivery_methods')
  expect(view.graph().nodes[1]!.data).toEqual(unrelated.data)
  expect(view.graph().edges).toEqual(edges)
  expect(postMigration).toHaveBeenCalledExactlyOnceWith(
    {
      body: { nodes: [{ node_id: 'legacy-human-input', node_data: createLegacyNode().data }] },
    },
    { context: { silent: true } },
  )
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  await act(async () => vi.advanceTimersByTime(500))
})

it('shows the current legacy count in the shared confirmation dialog', async () => {
  setup({ nodes: [createLegacyNode(false, 'legacy-one'), createLegacyNode(false, 'legacy-two')] })
  await openDialog(newUser())
  expect(
    screen.getByRole('alertdialog', {
      name: 'workflow.nodes.humanInputMigration.dialog.title:{"count":2}',
    }),
  ).toBeInTheDocument()
})

it('reports the server preflight blocker without changing the graph', async () => {
  const view = setup({ nodes: [createLegacyNode(true)] })
  const original = view.graph()
  postMigration.mockRejectedValueOnce(
    new ORPCError('BAD_REQUEST', {
      status: 400,
      data: {
        body: {
          status: 400,
          code: 'hitl_node_data_migration_failure',
          message: 'Human Input node-data migration failed.',
          blockers: [
            {
              code: 'invalid-default-value',
              node_id: 'legacy-human-input',
              node_title: 'Approval',
              value: 'default_value',
            },
          ],
        },
      },
    }),
  )
  await confirmMigration(newUser())
  expect(await screen.findByRole('alert')).toHaveTextContent('Approval')
  expect(screen.getByRole('alert')).toHaveTextContent(
    'workflow.nodes.humanInputMigration.blocker.invalidDefaultValue',
  )
  expect(view.graph()).toEqual(original)
  expect(screen.getByText('insertion-blocked')).toBeInTheDocument()
})

it('preserves a supported select field through migration', async () => {
  const input = createDefaultFormInputByType(InputVarType.select, 'decision')
  const view = setup({ nodes: [createLegacyNode(false, 'legacy-human-input', [input])] })
  await confirmMigration(newUser())
  expect(await screen.findByText('insertion-enabled')).toBeInTheDocument()
  expect(view.graph().nodes[0]!.data).toMatchObject({ version: '2', inputs: [input] })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('starts only one migration when confirmation is double-clicked during a draft save', async () => {
  let finishSave!: () => void
  const sync = vi.fn(
    () =>
      new Promise<{ hash: string; updatedAt: number }>((resolve) => {
        finishSave = () => resolve({ hash: 'saved', updatedAt: 1 })
      }),
  )
  const view = setup({ sync })
  const user = newUser()
  await openDialog(user)
  await user.dblClick(
    screen.getByRole('button', { name: 'workflow.nodes.humanInputMigration.action.migrate' }),
  )
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(view.graph().nodes[0]!.data.version).toBe('2')
  expect(postMigration).toHaveBeenCalledTimes(1)
  expect(sync).toHaveBeenCalledTimes(1)
  await act(async () => finishSave())
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(screen.getByText('insertion-enabled')).toBeInTheDocument()
})

it.each(['failed', 'skipped', 'skipped-without-settled', 'undefined'] as const)(
  'rolls back the graph and retains retry guidance when saving is %s',
  async (outcome) => {
    const sync = async (_notRefresh?: boolean, callback?: SyncDraftCallback) => {
      if (outcome === 'failed') callback?.onError?.()
      if (outcome !== 'skipped-without-settled') callback?.onSettled?.()
      return outcome === 'undefined' ? undefined : null
    }
    const view = setup({ nodes: [createLegacyNode(), createNode({ id: 'unrelated' })], sync })
    const original = view.graph()
    await confirmMigration(newUser())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'workflow.nodes.humanInputMigration.error.sync',
    )
    expect(view.graph()).toEqual(original)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('insertion-blocked')).toBeInTheDocument()
    expect(
      screen.getByText('workflow.nodes.humanInputMigration.banner.description'),
    ).toBeInTheDocument()
  },
)

it('accepts an actual draft result without a success callback', async () => {
  const view = setup({
    sync: async (_notRefresh, callback) => {
      callback?.onSettled?.()
      return { hash: 'saved-draft-hash', updatedAt: 123 }
    },
  })
  await confirmMigration(newUser())
  expect(await screen.findByText('insertion-enabled')).toBeInTheDocument()
  expect(view.graph().nodes[0]!.data.version).toBe('2')
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})

it('retains edits made through the real node owner during conversion and requests retry', async () => {
  const view = setup()
  let finishConversion!: () => void
  postMigration.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishConversion = () => resolve(migrationResponse([createLegacyNode()]))
      }),
  )
  await confirmMigration(newUser())
  act(() =>
    view.result.current.handleNodeDataUpdate({
      id: 'legacy-human-input',
      data: { title: 'Edited approval' },
    }),
  )
  await act(async () => finishConversion())
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'workflow.nodes.humanInputMigration.error.graphChanged',
  )
  expect(view.graph().nodes[0]!.data).toEqual({
    ...createLegacyNode().data,
    title: 'Edited approval',
  })
  expect(screen.getByText('insertion-blocked')).toBeInTheDocument()
})

it('offers no migration to a user without editing permission', () => {
  const view = setup({ canEdit: false })
  expect(
    screen.queryByRole('button', { name: 'workflow.nodes.humanInputMigration.action.migrateNow' }),
  ).not.toBeInTheDocument()
  expect(view.graph().nodes[0]!.data).toEqual(createLegacyNode().data)
  expect(postMigration).not.toHaveBeenCalled()
})
