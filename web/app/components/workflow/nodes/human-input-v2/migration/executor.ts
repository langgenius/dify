import type {
  HumanInputMigrationBlocker,
  HumanInputMigrationGraph,
  HumanInputMigrationResolverSnapshot,
} from './types'
import { cloneDeep } from 'es-toolkit/object'
import { applyHumanInputV2MigrationPlan, createHumanInputV2MigrationPlan } from './planner'

export type HumanInputMigrationExecutionResult =
  | { status: 'success'; migratedNodeIds: string[] }
  | { status: 'noop' }
  | { status: 'blocked'; blockers: HumanInputMigrationBlocker[] }
  | { status: 'sync-error'; error: unknown }

export type HumanInputMigrationExecutorDependencies = {
  getGraph: () => HumanInputMigrationGraph
  getResolverSnapshot: () => Promise<HumanInputMigrationResolverSnapshot>
  replaceGraph: (graph: HumanInputMigrationGraph, source: string) => void
  syncDraft: () => Promise<void>
  saveHistory: (migratedNodeIds: string[]) => void
}

export const executeHumanInputV2Migration = async ({
  getGraph,
  getResolverSnapshot,
  replaceGraph,
  syncDraft,
  saveHistory,
}: HumanInputMigrationExecutorDependencies): Promise<HumanInputMigrationExecutionResult> => {
  const originalGraph = cloneDeep(getGraph())
  const resolverSnapshot = await getResolverSnapshot()
  const plan = createHumanInputV2MigrationPlan(originalGraph, resolverSnapshot)

  if (plan.status === 'blocked') return { status: 'blocked', blockers: plan.blockers }
  if (!plan.replacements.length) return { status: 'noop' }

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
