import type { HumanInputNodeType } from '../../../human-input/types'
import type { HumanInputMigrationExecutorDependencies } from '../executor'
import type { HumanInputMigrationGraph } from '../types'
import type { Node } from '@/app/components/workflow/types'
import { ORPCError } from '@orpc/client'
import { describe, expect, it, vi } from 'vitest'
import { BlockEnum } from '@/app/components/workflow/types'
import { DeliveryMethodType } from '../../../human-input/types'
import { createHumanInputMigrationApi, executeHumanInputV2Migration } from '../executor'

vi.mock('@/service/client', () => ({
  consoleClient: {
    workspaces: { current: { humanInput: { nodeDataMigration: { post: vi.fn() } } } },
  },
}))

const migratedData = (title = 'Approval') => ({
  type: 'human-input' as const,
  version: '2',
  title,
  desc: '',
  form_content: '',
  inputs: [],
  user_actions: [],
  timeout: 3,
  timeout_unit: 'day' as const,
  recipients_spec: [{ type: 'initiator' as const }],
  message_template: { subject: '', body: '' },
  debug_mode: { enabled: false, channels: [] },
})

const createLegacyNode = (id: string, valid = true): Node => ({
  id,
  type: 'custom',
  position: { x: 100, y: 100 },
  data: {
    type: BlockEnum.HumanInput,
    title: `Human Input ${id}`,
    desc: '',
    delivery_methods: [
      {
        id: `${id}-method`,
        type: valid ? DeliveryMethodType.WebApp : DeliveryMethodType.Slack,
        enabled: true,
      },
    ],
    form_content: '',
    inputs: [],
    user_actions: [],
    timeout: 3,
    timeout_unit: 'day',
  } as HumanInputNodeType,
})

const createHarness = (
  initialGraph: HumanInputMigrationGraph,
  syncDraft = vi.fn().mockResolvedValue(undefined),
) => {
  let graph = initialGraph
  const observedGraphs: HumanInputMigrationGraph[] = []
  const replaceGraph = vi.fn((nextGraph: HumanInputMigrationGraph) => {
    graph = nextGraph
    observedGraphs.push(nextGraph)
  })
  const saveHistory = vi.fn()
  const post = vi
    .fn<NonNullable<Parameters<typeof createHumanInputMigrationApi>[0]>['post']>()
    .mockResolvedValue({
      data: initialGraph.nodes.map((node) => ({
        node_id: node.id,
        node_data: migratedData(node.data.title),
      })),
    })
  const realMigrationApi = createHumanInputMigrationApi({ post })
  const migrationApi = { migrate: vi.fn(realMigrationApi.migrate) }
  const dependencies: HumanInputMigrationExecutorDependencies = {
    getGraph: () => graph,
    migrationApi,
    replaceGraph,
    syncDraft,
    saveHistory,
  }

  return {
    dependencies,
    getGraph: () => graph,
    editGraph: (nextGraph: HumanInputMigrationGraph) => {
      graph = nextGraph
    },
    migrationApi,
    post,
    observedGraphs,
    replaceGraph,
    saveHistory,
    syncDraft,
  }
}

describe('Human Input migration executor', () => {
  it('applies one complete graph replacement, one sync, and one history transaction', async () => {
    const originalGraph: HumanInputMigrationGraph = {
      nodes: [createLegacyNode('a'), createLegacyNode('b')],
      edges: [
        {
          id: 'a-approve-b-target',
          source: 'a',
          sourceHandle: 'approve',
          target: 'b',
          targetHandle: 'target',
          data: { sourceType: BlockEnum.HumanInput, targetType: BlockEnum.HumanInput },
        },
      ],
    }
    const harness = createHarness(originalGraph)

    const result = await executeHumanInputV2Migration(harness.dependencies)

    expect(result).toEqual({ status: 'success', migratedNodeIds: ['a', 'b'] })
    expect(harness.replaceGraph).toHaveBeenCalledTimes(1)
    expect(harness.migrationApi.migrate).toHaveBeenCalledTimes(1)
    expect(harness.migrationApi.migrate).toHaveBeenCalledWith({
      nodes: [expect.objectContaining({ node_id: 'a' }), expect.objectContaining({ node_id: 'b' })],
    })
    expect(harness.syncDraft).toHaveBeenCalledTimes(1)
    expect(harness.saveHistory).toHaveBeenCalledTimes(1)
    expect(harness.saveHistory).toHaveBeenCalledWith(['a', 'b'])
    expect(harness.observedGraphs[0]?.nodes.map((node) => node.data)).toEqual([
      expect.objectContaining({ version: '2' }),
      expect.objectContaining({ version: '2' }),
    ])
    expect(harness.getGraph().nodes.map((node) => node.id)).toEqual(['a', 'b'])
    expect(harness.getGraph().edges).toEqual(originalGraph.edges)
  })

  it('finishes batch preflight before mutation and reports node-specific blockers', async () => {
    const harness = createHarness({
      nodes: [createLegacyNode('valid'), createLegacyNode('invalid', false)],
      edges: [],
    })

    harness.post.mockRejectedValueOnce(
      new ORPCError('BAD_REQUEST', {
        status: 400,
        data: {
          code: 'hitl_node_data_migration_failure',
          status: 400,
          message: 'Human Input node-data migration failed.',
          blockers: [
            {
              code: 'unsupported-delivery-method',
              node_id: 'invalid',
              node_title: 'Human Input invalid',
              method_id: 'invalid-method',
              value: 'slack',
            },
          ],
        },
      }),
    )
    const result = await executeHumanInputV2Migration(harness.dependencies)

    expect(result).toEqual({
      status: 'blocked',
      blockers: [
        {
          code: 'unsupported-delivery-method',
          nodeId: 'invalid',
          nodeTitle: 'Human Input invalid',
          methodId: 'invalid-method',
          value: 'slack',
        },
      ],
    })
    expect(harness.replaceGraph).not.toHaveBeenCalled()
    expect(harness.migrationApi.migrate).toHaveBeenCalledTimes(1)
    expect(harness.syncDraft).not.toHaveBeenCalled()
    expect(harness.saveHistory).not.toHaveBeenCalled()
  })

  it('restores every migrated node when draft synchronization rejects', async () => {
    const originalGraph = {
      nodes: [createLegacyNode('a'), createLegacyNode('b')],
      edges: [],
    }
    const syncError = new Error('sync rejected')
    const harness = createHarness(originalGraph, vi.fn().mockRejectedValue(syncError))

    const result = await executeHumanInputV2Migration(harness.dependencies)

    expect(result).toEqual({ status: 'sync-error', error: syncError })
    expect(harness.replaceGraph).toHaveBeenCalledTimes(2)
    expect(harness.observedGraphs[0]?.nodes.map((node) => node.data)).toEqual([
      expect.objectContaining({ version: '2' }),
      expect.objectContaining({ version: '2' }),
    ])
    expect(harness.observedGraphs[1]).toEqual(originalGraph)
    expect(harness.getGraph()).toEqual(originalGraph)
    expect(harness.saveHistory).not.toHaveBeenCalled()
  })

  it('is a no-op for an already migrated graph', async () => {
    const v2Node = createLegacyNode('v2')
    v2Node.data = {
      ...v2Node.data,
      version: '2',
      recipients_spec: [{ type: 'initiator' }],
      message_template: { subject: '', body: '' },
      debug_mode: { enabled: false, channels: [] },
    } as unknown as Node['data']
    delete (v2Node.data as Record<string, unknown>).delivery_methods
    const harness = createHarness({ nodes: [v2Node], edges: [] })

    expect(await executeHumanInputV2Migration(harness.dependencies)).toEqual({ status: 'noop' })
    expect(harness.replaceGraph).not.toHaveBeenCalled()
    expect(harness.migrationApi.migrate).not.toHaveBeenCalled()
    expect(harness.syncDraft).not.toHaveBeenCalled()
    expect(harness.saveHistory).not.toHaveBeenCalled()
  })

  it('rejects an incomplete batch response before graph mutation', async () => {
    const harness = createHarness({ nodes: [createLegacyNode('a')], edges: [] })
    harness.migrationApi.migrate.mockResolvedValueOnce({ status: 'success', data: [] })

    await expect(executeHumanInputV2Migration(harness.dependencies)).rejects.toThrow(
      'human-input-migration-invalid-response',
    )
    expect(harness.replaceGraph).not.toHaveBeenCalled()
    expect(harness.syncDraft).not.toHaveBeenCalled()
    expect(harness.saveHistory).not.toHaveBeenCalled()
  })

  it('uses backend recipient conversion and normalizes nullable paragraph defaults', async () => {
    const node = createLegacyNode('a')
    const harness = createHarness({ nodes: [node], edges: [] })
    harness.post.mockResolvedValueOnce({
      data: [
        {
          node_id: 'a',
          node_data: {
            ...migratedData(),
            recipients_spec: [
              { type: 'all_workspace_contacts' },
              { type: 'onetime_email', email: 'member@example.com' },
            ],
            inputs: [{ type: 'paragraph', output_variable_name: 'answer', default: null }],
          },
        },
      ],
    })
    await executeHumanInputV2Migration(harness.dependencies)
    expect(harness.post).toHaveBeenCalledWith(
      { body: { nodes: [{ node_id: 'a', node_data: node.data }] } },
      { context: { silent: true } },
    )
    expect(harness.getGraph().nodes[0]?.data).toMatchObject({
      recipients_spec: [
        { type: 'all_workspace_contacts' },
        { type: 'onetime_email', email: 'member@example.com' },
      ],
      inputs: [
        {
          type: 'paragraph',
          output_variable_name: 'answer',
          default: { type: 'constant', selector: [], value: '' },
        },
      ],
    })
    expect(harness.getGraph().nodes[0]?.data).not.toHaveProperty('delivery_methods')
  })

  it.each(['edit', 'delete', 'add', 'permission'] as const)(
    'keeps current edits when the batch changes during conversion: %s',
    async (change) => {
      const initial = { nodes: [createLegacyNode('a')], edges: [] }
      const harness = createHarness(initial)
      let canApply = true
      harness.dependencies.canApply = () => canApply
      harness.post.mockImplementationOnce(async () => {
        if (change === 'edit')
          harness.editGraph({
            ...initial,
            nodes: [
              {
                ...createLegacyNode('a'),
                data: { ...createLegacyNode('a').data, title: 'New edit' },
              },
            ],
          })
        if (change === 'delete') harness.editGraph({ nodes: [], edges: [] })
        if (change === 'add')
          harness.editGraph({ ...initial, nodes: [...initial.nodes, createLegacyNode('b')] })
        if (change === 'permission') canApply = false
        return { data: [{ node_id: 'a', node_data: migratedData() }] }
      })
      expect(await executeHumanInputV2Migration(harness.dependencies)).toEqual({
        status: 'graph-changed',
      })
      expect(harness.replaceGraph).not.toHaveBeenCalled()
      expect(harness.syncDraft).not.toHaveBeenCalled()
      expect(harness.saveHistory).not.toHaveBeenCalled()
    },
  )

  it('preserves layout, new unrelated nodes, and edges edited during backend conversion', async () => {
    const node = createLegacyNode('a')
    const harness = createHarness({ nodes: [node], edges: [] })
    const other: Node = {
      id: 'other',
      position: { x: 0, y: 0 },
      data: { title: 'New node', desc: '', type: BlockEnum.Start },
    }
    const edge = { id: 'new-edge', source: 'a', target: 'other' }
    harness.post.mockImplementationOnce(async () => {
      harness.editGraph({
        nodes: [{ ...node, position: { x: 500, y: 200 } }, other],
        edges: [edge],
      })
      return { data: [{ node_id: 'a', node_data: migratedData() }] }
    })
    await executeHumanInputV2Migration(harness.dependencies)
    expect(harness.getGraph().nodes[0]?.position).toEqual({ x: 500, y: 200 })
    expect(harness.getGraph().nodes[1]).toEqual(other)
    expect(harness.getGraph().edges).toEqual([edge])
  })

  it('rolls back untouched migrated data while retaining edits made during draft saving', async () => {
    const original = { nodes: [createLegacyNode('a'), createLegacyNode('b')], edges: [] }
    const harness = createHarness(original)
    const edge = { id: 'new-edge', source: 'a', target: 'b' }
    harness.syncDraft.mockImplementationOnce(async () => {
      const current = harness.getGraph()
      harness.editGraph({
        nodes: current.nodes.map((node) =>
          node.id === 'a'
            ? { ...node, data: { ...node.data, title: 'Edited while saving' } }
            : { ...node, position: { x: 800, y: 800 } },
        ),
        edges: [edge],
      })
      throw new Error('save failed')
    })
    expect(await executeHumanInputV2Migration(harness.dependencies)).toMatchObject({
      status: 'sync-error',
    })
    expect(harness.getGraph().nodes[0]?.data).toMatchObject({
      title: 'Edited while saving',
      version: '2',
    })
    expect(harness.getGraph().nodes[1]?.data).toEqual(original.nodes[1]?.data)
    expect(harness.getGraph().nodes[1]?.position).toEqual({ x: 800, y: 800 })
    expect(harness.getGraph().edges).toEqual([edge])
    expect(harness.saveHistory).not.toHaveBeenCalled()
  })

  it('maps the server invalid-default-value blocker from an HTTP response', async () => {
    const harness = createHarness({ nodes: [createLegacyNode('a')], edges: [] })
    harness.post.mockRejectedValueOnce(
      new Response(
        JSON.stringify({
          message: 'Human Input node-data migration failed.',
          status: 400,
          code: 'hitl_node_data_migration_failure',
          blockers: [
            {
              code: 'invalid-default-value',
              node_id: 'a',
              node_title: 'Approval',
              method_id: null,
              value: 'default_value',
            },
          ],
        }),
        { status: 400 },
      ),
    )
    expect(await executeHumanInputV2Migration(harness.dependencies)).toEqual({
      status: 'blocked',
      blockers: [
        {
          code: 'invalid-default-value',
          nodeId: 'a',
          nodeTitle: 'Approval',
          methodId: undefined,
          value: 'default_value',
        },
      ],
    })
    expect(harness.replaceGraph).not.toHaveBeenCalled()
  })

  it.each([403, 500])(
    'does not treat HTTP %s as a successful migration or a business blocker',
    async (status) => {
      const harness = createHarness({ nodes: [createLegacyNode('a')], edges: [] })
      const error = new ORPCError('FORBIDDEN', { status, data: { message: 'Request failed' } })
      harness.post.mockRejectedValueOnce(error)
      await expect(executeHumanInputV2Migration(harness.dependencies)).rejects.toBe(error)
      expect(harness.replaceGraph).not.toHaveBeenCalled()
      expect(harness.saveHistory).not.toHaveBeenCalled()
    },
  )
})
