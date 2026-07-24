import type { HumanInputNodeType } from '../../human-input/types'
import type {
  HumanInputMigrationApi,
  HumanInputMigrationBlocker,
  HumanInputMigrationGraph,
  HumanInputMigrationPlan,
} from './types'
import { cloneDeep } from 'es-toolkit/object'
import { isHumanInputV2NodeData } from '../types'
import { applyHumanInputV2MigrationPlan } from './planner'
import { classifyHumanInputVersion, HumanInputVersionKind } from './policy'
import { HumanInputMigrationBlockerCode } from './types'

export type HumanInputMigrationExecutionResult =
  | { status: 'success'; migratedNodeIds: string[] }
  | { status: 'noop' }
  | { status: 'blocked'; blockers: HumanInputMigrationBlocker[] }
  | { status: 'sync-error'; error: unknown }

export type HumanInputMigrationExecutorDependencies = {
  getGraph: () => HumanInputMigrationGraph
  migrationApi: HumanInputMigrationApi
  replaceGraph: (graph: HumanInputMigrationGraph, source: string) => void
  syncDraft: () => Promise<void>
  saveHistory: (migratedNodeIds: string[]) => void
}

export const executeHumanInputV2Migration = async ({
  getGraph,
  migrationApi,
  replaceGraph,
  syncDraft,
  saveHistory,
}: HumanInputMigrationExecutorDependencies): Promise<HumanInputMigrationExecutionResult> => {
  const originalGraph = cloneDeep(getGraph())
  const blockers: HumanInputMigrationBlocker[] = []
  const nodes = originalGraph.nodes.flatMap((node) => {
    const kind = classifyHumanInputVersion(node.data)
    if (kind === HumanInputVersionKind.V2 || kind === HumanInputVersionKind.NotHumanInput) return []
    if (kind === HumanInputVersionKind.LegacyBlocked) {
      blockers.push({
        nodeId: node.id,
        nodeTitle: node.data.title,
        code: HumanInputMigrationBlockerCode.UnsupportedVersion,
        value: String((node.data as { version?: unknown }).version),
      })
      return []
    }
    return [{ node_id: node.id, node_data: cloneDeep(node.data) as HumanInputNodeType }]
  })

  if (blockers.length) return { status: 'blocked', blockers }
  if (!nodes.length) return { status: 'noop' }

  const apiResult = await migrationApi.migrate({ nodes })
  if (apiResult.status === 'blocked') return apiResult

  const expectedNodeIds = new Set(nodes.map((node) => node.node_id))
  const seenNodeIds = new Set<string>()
  const replacements: Extract<HumanInputMigrationPlan, { status: 'ready' }>['replacements'] = []

  for (const item of apiResult.data) {
    if (
      !expectedNodeIds.has(item.node_id) ||
      seenNodeIds.has(item.node_id) ||
      !isHumanInputV2NodeData(item.node_data)
    )
      throw new Error('human-input-migration-invalid-response')
    seenNodeIds.add(item.node_id)
    replacements.push({ nodeId: item.node_id, data: item.node_data })
  }

  if (seenNodeIds.size !== expectedNodeIds.size)
    throw new Error('human-input-migration-invalid-response')

  const plan: Extract<HumanInputMigrationPlan, { status: 'ready' }> = {
    status: 'ready',
    replacements,
  }

  const migratedGraph = applyHumanInputV2MigrationPlan(originalGraph, plan)
  replaceGraph(migratedGraph, 'human-input-v2:migrate')

  try {
    await syncDraft()
    const migratedNodeIds = plan.replacements.map((replacement) => replacement.nodeId)
    saveHistory(migratedNodeIds)
    return { status: 'success', migratedNodeIds }
  } catch (error) {
    replaceGraph(originalGraph, 'human-input-v2:migrate-rollback')
    return { status: 'sync-error', error }
  }
}
