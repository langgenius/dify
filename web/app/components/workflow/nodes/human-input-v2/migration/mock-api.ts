import type { HumanInputMigrationApi, HumanInputMigrationResolverSnapshot } from './types'
import type { Node } from '@/app/components/workflow/types'
import { cloneDeep } from 'es-toolkit/object'
import { createHumanInputV2MigrationPlan } from './planner'

export function createMockHumanInputMigrationApi(
  getResolverSnapshot: () => Promise<HumanInputMigrationResolverSnapshot>,
): HumanInputMigrationApi {
  return {
    async migrate(request) {
      const resolverSnapshot = await getResolverSnapshot()
      const nodes = request.nodes.map(
        ({ node_id, node_data }, index): Node => ({
          id: node_id,
          type: 'custom',
          position: { x: 0, y: index },
          data: cloneDeep(node_data),
        }),
      )
      const plan = createHumanInputV2MigrationPlan({ nodes, edges: [] }, resolverSnapshot)

      if (plan.status === 'blocked') return plan

      return {
        status: 'success',
        data: plan.replacements.map(({ nodeId, data }) => ({
          node_id: nodeId,
          node_data: data,
        })),
      }
    },
  }
}
