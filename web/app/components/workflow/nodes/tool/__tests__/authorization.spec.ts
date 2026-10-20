import type { AppUserAuthSliceShape } from '../../../store/workflow/app-user-auth-slice'
import type { Node } from '../../../types'
import { CollectionType } from '@/app/components/tools/types'
import { createNode } from '../../../__tests__/fixtures'
import { BlockEnum } from '../../../types'
import { resolveToolAuthorization } from '../authorization'

const makeTool = (
  id: string,
  providerId = 'google',
  providerType: CollectionType = CollectionType.builtIn,
) =>
  createNode({
    id,
    data: {
      type: BlockEnum.Tool,
      provider_id: providerId,
      provider_type: providerType,
      provider_name: 'google',
      tool_name: id,
      tool_parameters: {},
      tool_configurations: {},
    },
  })
const reuse = (sourceId?: string): AppUserAuthSliceShape['nodeAuthDrafts'][string] => ({
  provider: 'google',
  providerId: 'google',
  authorizationTab: 'reuse-from-node',
  reuseFromNode: sourceId ? { source: { id: sourceId, title: sourceId } } : undefined,
})

it.each<{
  name: string
  drafts: AppUserAuthSliceShape['nodeAuthDrafts']
  nodes: Node[]
  reason: string
}>([
  {
    name: 'unselected source',
    drafts: { current: reuse() },
    nodes: [makeTool('source')],
    reason: 'unselected',
  },
  { name: 'deleted source', drafts: { current: reuse('source') }, nodes: [], reason: 'missing' },
  {
    name: 'deleted transitive source',
    drafts: { current: reuse('middle'), middle: reuse('source') },
    nodes: [makeTool('middle')],
    reason: 'missing',
  },
  {
    name: 'changed provider ID',
    drafts: { current: reuse('source') },
    nodes: [makeTool('source', 'another-provider')],
    reason: 'incompatible',
  },
  {
    name: 'changed provider type',
    drafts: { current: reuse('source') },
    nodes: [makeTool('source', 'google', CollectionType.custom)],
    reason: 'incompatible',
  },
  {
    name: 'cycle after source changes',
    drafts: { current: reuse('middle'), middle: reuse('current') },
    nodes: [makeTool('middle'), makeTool('current')],
    reason: 'cycle',
  },
])('rejects a $name using the live graph', ({ drafts, nodes, reason }) => {
  expect(
    resolveToolAuthorization({ node: makeTool('current'), nodes, nodeAuthDrafts: drafts }),
  ).toEqual({ status: 'invalid', reason })
})
