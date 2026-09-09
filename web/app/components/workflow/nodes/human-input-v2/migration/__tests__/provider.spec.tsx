import type { SyncDraftCallback } from '@/app/components/workflow/hooks-store'
import type { Node } from '@/app/components/workflow/types'
import { ORPCError } from '@orpc/client'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { use } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BlockEnum } from '@/app/components/workflow/types'
import { HumanInputMigrationContext } from '../context'
import HumanInputMigrationProvider from '../provider'

const runtime = vi.hoisted(() => ({
  nodes: [] as Node[],
  edges: [] as never[],
}))
const mocks = vi.hoisted(() => ({
  postMigration: vi.fn(),
  setNodes: vi.fn(),
  doSync: vi.fn(),
  saveHistory: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('reactflow', () => ({
  useNodes: () => runtime.nodes,
  useStoreApi: () => ({
    getState: () => ({
      getNodes: () => runtime.nodes,
      edges: runtime.edges,
    }),
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-collaborative-workflow', () => ({
  useCollaborativeWorkflow: () => ({
    setNodes: (...args: unknown[]) => mocks.setNodes(...args),
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-nodes-meta-data', () => ({
  useNodesMetaData: () => ({
    nodesMap: {
      [BlockEnum.HumanInputV2]: {
        metaData: { helpLinkUri: 'https://docs.example/human-input' },
      },
    },
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    doSyncWorkflowDraft: (...args: unknown[]) => mocks.doSync(...args),
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-workflow-history', () => ({
  useWorkflowHistory: () => ({ saveStateToHistory: mocks.saveHistory }),
  WorkflowHistoryEvent: { HumanInputMigration: 'HumanInputMigration' },
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    workspaces: {
      current: {
        humanInput: {
          nodeDataMigration: { post: (...args: unknown[]) => mocks.postMigration(...args) },
        },
      },
    },
  },
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: (...args: unknown[]) => mocks.toastError(...args),
    success: (...args: unknown[]) => mocks.toastSuccess(...args),
  },
}))

const createLegacyNode = (unsupported = false, id = 'legacy-human-input'): Node => ({
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
    inputs: [],
    user_actions: [],
    timeout: 3,
    timeout_unit: 'day',
  } as Node['data'],
})

const PolicyProbe = () => {
  const migration = use(HumanInputMigrationContext)
  return (
    <div>{migration?.policy.canAddHumanInputV2 ? 'insertion-enabled' : 'insertion-blocked'}</div>
  )
}

const renderProvider = (canEdit = true) =>
  render(
    <HumanInputMigrationProvider canEdit={canEdit}>
      <PolicyProbe />
    </HumanInputMigrationProvider>,
  )

describe('Human Input migration provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runtime.nodes = [createLegacyNode()]
    runtime.edges = []
    mocks.postMigration.mockImplementation(async () => ({
      data: runtime.nodes.map((node) => ({
        node_id: node.id,
        node_data: {
          title: node.data.title,
          type: 'human-input',
          version: '2',
          form_content: '',
          inputs: [],
          user_actions: [],
          timeout: 3,
          timeout_unit: 'day',
          recipients_spec: [{ type: 'initiator' }],
          message_template: { subject: '', body: '' },
          debug_mode: { enabled: false, channels: [] },
        },
      })),
    }))
    mocks.setNodes.mockImplementation((nodes: Node[]) => {
      runtime.nodes = nodes
    })
    mocks.doSync.mockImplementation(
      async (_notRefreshWhenSyncError: boolean, callback?: SyncDraftCallback) => {
        callback?.onSuccess?.()
        callback?.onSettled?.()
      },
    )
  })

  it('migrates through one shared dialog, syncs once, and derives the completed UI state', async () => {
    const user = userEvent.setup()
    const view = renderProvider()
    expect(screen.getByText('insertion-blocked')).toBeInTheDocument()
    expect(
      screen.getByRole('complementary', {
        name: 'workflow.nodes.humanInputMigration.banner.ariaLabel',
      }),
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: 'workflow.nodes.humanInputMigration.action.migrateNow',
      }),
    )
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputMigration.action.migrate' }),
    )

    await waitFor(() => expect(mocks.doSync).toHaveBeenCalledTimes(1))
    expect(mocks.setNodes).toHaveBeenCalledTimes(1)
    expect(mocks.postMigration).toHaveBeenCalledTimes(1)
    expect(mocks.postMigration).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { nodes: [expect.objectContaining({ node_id: 'legacy-human-input' })] },
      }),
      { context: { silent: true } },
    )
    expect(mocks.saveHistory).toHaveBeenCalledTimes(1)
    expect(mocks.toastSuccess).toHaveBeenCalledWith('workflow.nodes.humanInputMigration.success')
    expect((runtime.nodes[0]!.data as { version?: unknown }).version).toBe('2')

    view.rerender(
      <HumanInputMigrationProvider canEdit>
        <PolicyProbe />
      </HumanInputMigrationProvider>,
    )
    expect(screen.getByText('insertion-enabled')).toBeInTheDocument()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('shows the current legacy-node count in the shared confirmation dialog', async () => {
    runtime.nodes = [createLegacyNode(false, 'legacy-one'), createLegacyNode(false, 'legacy-two')]
    const user = userEvent.setup()
    renderProvider()

    await user.click(
      screen.getByRole('button', {
        name: 'workflow.nodes.humanInputMigration.action.migrateNow',
      }),
    )

    expect(
      screen.getByRole('alertdialog', {
        name: 'workflow.nodes.humanInputMigration.dialog.title:{"count":2}',
      }),
    ).toBeInTheDocument()
  })

  it('finishes preflight before mutation and reports a node-specific blocker', async () => {
    runtime.nodes = [createLegacyNode(true)]
    mocks.postMigration.mockRejectedValueOnce(
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
    const user = userEvent.setup()
    renderProvider()
    await user.click(
      screen.getByRole('button', {
        name: 'workflow.nodes.humanInputMigration.action.migrateNow',
      }),
    )
    await user.click(
      screen.getByRole('button', {
        name: 'workflow.nodes.humanInputMigration.action.migrate',
      }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Approval')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'workflow.nodes.humanInputMigration.blocker.invalidDefaultValue',
    )
    expect(mocks.setNodes).not.toHaveBeenCalled()
    expect(mocks.doSync).not.toHaveBeenCalled()
    expect(mocks.saveHistory).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })

  it('locks duplicate confirmation while pending', async () => {
    let settleSync: (() => void) | undefined
    mocks.doSync.mockImplementation(
      (_notRefreshWhenSyncError: boolean, callback?: SyncDraftCallback) =>
        new Promise<void>((resolve) => {
          settleSync = () => {
            callback?.onSuccess?.()
            callback?.onSettled?.()
            resolve()
          }
        }),
    )
    const user = userEvent.setup()
    renderProvider()
    await user.click(
      screen.getByRole('button', {
        name: 'workflow.nodes.humanInputMigration.action.migrateNow',
      }),
    )
    const confirm = screen.getByRole('button', {
      name: 'workflow.nodes.humanInputMigration.action.migrate',
    })
    await user.dblClick(confirm)

    expect(mocks.setNodes).toHaveBeenCalledTimes(1)
    expect(mocks.doSync).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole('button', { name: /workflow.nodes.humanInputMigration.action.migrating/ }),
    ).toHaveAttribute('aria-disabled', 'true')

    await act(async () => settleSync?.())
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledTimes(1))
  })

  it('rolls back the complete graph and retains retry guidance after sync failure', async () => {
    const originalNode = runtime.nodes[0]!
    mocks.doSync.mockImplementation(
      async (_notRefreshWhenSyncError: boolean, callback?: SyncDraftCallback) => {
        callback?.onError?.()
        callback?.onSettled?.()
      },
    )
    const user = userEvent.setup()
    renderProvider()
    await user.click(
      screen.getByRole('button', {
        name: 'workflow.nodes.humanInputMigration.action.migrateNow',
      }),
    )
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputMigration.action.migrate' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'workflow.nodes.humanInputMigration.error.sync',
    )
    expect(mocks.setNodes).toHaveBeenCalledTimes(2)
    expect(runtime.nodes).toEqual([originalNode])
    expect(mocks.saveHistory).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(
      screen.getByText('workflow.nodes.humanInputMigration.banner.description'),
    ).toBeInTheDocument()
  })

  it.each([
    { result: null, settles: true },
    { result: null, settles: false },
    { result: undefined, settles: true },
  ])(
    'rolls back when draft saving is skipped ($result, settled: $settles)',
    async ({ result, settles }) => {
      const originalNodes = runtime.nodes
      mocks.doSync.mockImplementation(
        async (_notRefreshWhenSyncError: boolean, callback?: SyncDraftCallback) => {
          if (settles) callback?.onSettled?.()
          return result
        },
      )
      const user = userEvent.setup()
      renderProvider()
      await user.click(
        screen.getByRole('button', {
          name: 'workflow.nodes.humanInputMigration.action.migrateNow',
        }),
      )
      await user.click(
        screen.getByRole('button', { name: 'workflow.nodes.humanInputMigration.action.migrate' }),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'workflow.nodes.humanInputMigration.error.sync',
      )
      expect(mocks.setNodes).toHaveBeenCalledTimes(2)
      expect(runtime.nodes).toEqual(originalNodes)
      expect(mocks.saveHistory).not.toHaveBeenCalled()
      expect(mocks.toastSuccess).not.toHaveBeenCalled()
    },
  )

  it('accepts an actual draft save result even without a success callback', async () => {
    mocks.doSync.mockImplementation(
      async (_notRefreshWhenSyncError: boolean, callback?: SyncDraftCallback) => {
        callback?.onSettled?.()
        return { hash: 'saved-draft-hash', updatedAt: 123 }
      },
    )
    const user = userEvent.setup()
    renderProvider()
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputMigration.action.migrateNow' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputMigration.action.migrate' }),
    )

    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledTimes(1))
    expect(mocks.setNodes).toHaveBeenCalledTimes(1)
    expect(mocks.saveHistory).toHaveBeenCalledTimes(1)
  })

  it('retains new node edits and shows retry guidance when the graph changes during conversion', async () => {
    mocks.postMigration.mockImplementationOnce(async () => {
      runtime.nodes = [createLegacyNode(false, 'new-node')]
      return {
        data: [
          {
            node_id: 'legacy-human-input',
            node_data: {
              title: 'Approval',
              version: '2',
              recipients_spec: [{ type: 'initiator' }],
              message_template: { subject: '', body: '' },
              debug_mode: { channels: [] },
            },
          },
        ],
      }
    })
    const user = userEvent.setup()
    renderProvider()
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputMigration.action.migrateNow' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputMigration.action.migrate' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'workflow.nodes.humanInputMigration.error.graphChanged',
    )
    expect(runtime.nodes[0]?.id).toBe('new-node')
    expect(mocks.setNodes).not.toHaveBeenCalled()
    expect(mocks.doSync).not.toHaveBeenCalled()
    expect(mocks.saveHistory).not.toHaveBeenCalled()
  })

  it('does not offer migration to a user without editing permission', () => {
    renderProvider(false)
    expect(
      screen.queryByRole('button', {
        name: 'workflow.nodes.humanInputMigration.action.migrateNow',
      }),
    ).not.toBeInTheDocument()
    expect(mocks.postMigration).not.toHaveBeenCalled()
  })
})
