import type { AppUserAuthSliceShape } from '../../store/workflow/app-user-auth-slice'
import type { Node } from '../../types'
import { BlockEnum } from '../../types'

type NodeAuthorizationDraft = AppUserAuthSliceShape['nodeAuthDrafts'][string]

export type ToolAuthorizationResolution =
  | {
      status: 'resolved'
      authorizationTab: 'workspace-auth'
      sourceNodeId: string
    }
  | {
      status: 'resolved'
      authorizationTab: 'app-user-auth'
      sourceNodeId: string
      appUserDraft: NodeAuthorizationDraft
    }
  | {
      status: 'invalid'
      reason: 'unselected' | 'missing' | 'incompatible' | 'cycle'
    }

type ResolveToolAuthorizationParams = {
  node: Pick<Node, 'id' | 'data'>
  nodes: readonly Node[]
  nodeAuthDrafts: AppUserAuthSliceShape['nodeAuthDrafts']
  provider?: string
}

// Resolve UI-only references against the live graph, never the saved display snapshot.
export const resolveToolAuthorization = ({
  node,
  nodes,
  nodeAuthDrafts,
  provider,
}: ResolveToolAuthorizationParams): ToolAuthorizationResolution | undefined => {
  if (node.data.type !== BlockEnum.Tool) return undefined

  const nodesById = new Map(nodes.map((item) => [item.id, item]))
  const visited = new Set<string>()
  const providerName = provider ?? nodeAuthDrafts[node.id]?.provider
  let source = node

  while (true) {
    if (visited.has(source.id)) return { status: 'invalid', reason: 'cycle' }
    visited.add(source.id)

    const storedDraft = nodeAuthDrafts[source.id]
    const draft =
      storedDraft &&
      storedDraft.providerId === source.data.provider_id &&
      (!providerName || storedDraft.provider === providerName)
        ? storedDraft
        : undefined
    if (draft?.authorizationTab === 'app-user-auth')
      return {
        status: 'resolved',
        authorizationTab: 'app-user-auth',
        sourceNodeId: source.id,
        appUserDraft: draft,
      }
    if (draft?.authorizationTab !== 'reuse-from-node')
      return { status: 'resolved', authorizationTab: 'workspace-auth', sourceNodeId: source.id }

    const sourceId = draft.reuseFromNode?.source.id
    if (!sourceId) return { status: 'invalid', reason: 'unselected' }
    const target = nodesById.get(sourceId)
    if (!target) return { status: 'invalid', reason: 'missing' }
    if (
      target.data.type !== BlockEnum.Tool ||
      target.data.provider_type !== node.data.provider_type ||
      target.data.provider_id !== node.data.provider_id
    )
      return { status: 'invalid', reason: 'incompatible' }
    source = target
  }
}
