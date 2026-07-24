import type { HumanInputNodeType } from '../../../human-input/types'
import type {
  HumanInputMigrationExecutionResult,
  HumanInputMigrationExecutorDependencies,
} from '../executor'
import type { HumanInputMigrationGraph } from '../types'
import type { Node } from '@/app/components/workflow/types'
import { describe, expect, it, vi } from 'vitest'
import { BlockEnum } from '@/app/components/workflow/types'
import { DeliveryMethodType } from '../../../human-input/types'
import { executeHumanInputV2Migration } from '../executor'
import { createMockHumanInputMigrationApi } from '../mock-api'

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
  const mockMigrationApi = createMockHumanInputMigrationApi(async () => ({
    members: [],
    contacts: [],
  }))
  const migrationApi = {
    migrate: vi.fn(mockMigrationApi.migrate),
  }
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
    migrationApi,
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
    expect(
      harness.observedGraphs[0]!.nodes.every(
        (node) => (node.data as { version?: unknown }).version === '2',
      ),
    ).toBe(true)
    expect(harness.getGraph().nodes.map((node) => node.id)).toEqual(['a', 'b'])
    expect(harness.getGraph().edges).toEqual(originalGraph.edges)
  })

  it('finishes batch preflight before mutation and reports node-specific blockers', async () => {
    const harness = createHarness({
      nodes: [createLegacyNode('valid'), createLegacyNode('invalid', false)],
      edges: [],
    })

    const result = await executeHumanInputV2Migration(harness.dependencies)

    expect(result.status).toBe('blocked')
    expect(
      (result as Extract<HumanInputMigrationExecutionResult, { status: 'blocked' }>).blockers,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ nodeId: 'invalid' })]))
    expect(harness.replaceGraph).not.toHaveBeenCalled()
    expect(harness.migrationApi.migrate).toHaveBeenCalledTimes(1)
    expect(harness.syncDraft).not.toHaveBeenCalled()
    expect(harness.saveHistory).not.toHaveBeenCalled()
  })

  it('restores the full original snapshot when draft synchronization rejects', async () => {
    const originalGraph = {
      nodes: [createLegacyNode('a'), createLegacyNode('b')],
      edges: [],
    }
    const syncError = new Error('sync rejected')
    const harness = createHarness(originalGraph, vi.fn().mockRejectedValue(syncError))

    const result = await executeHumanInputV2Migration(harness.dependencies)

    expect(result).toEqual({ status: 'sync-error', error: syncError })
    expect(harness.replaceGraph).toHaveBeenCalledTimes(2)
    expect(
      harness.observedGraphs[0]!.nodes.every(
        (node) => (node.data as { version?: unknown }).version === '2',
      ),
    ).toBe(true)
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
})
