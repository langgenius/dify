import type { Node } from '../../types'
import type { ToolNodeType } from './types'
import type {
  AppUserAuthDraft,
  AppUserAuthErrors,
} from '@/app/components/plugins/plugin-auth/app-user-auth/draft'
import { validateAppUserAuth } from '@/app/components/plugins/plugin-auth/app-user-auth/draft'
import { BlockEnum } from '../../types'
import { getAppUserAuthDraft, getToolAuthorizationTab } from './authorization-config'
import { ToolCredentialSource } from './types'

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
      appUserDraft: { draft: AppUserAuthDraft; errors: AppUserAuthErrors }
    }
  | {
      status: 'invalid'
      reason: 'unselected' | 'missing' | 'incompatible' | 'cycle' | 'indirect'
    }

type ResolveToolAuthorizationParams = {
  node: Pick<Node, 'id' | 'data'>
  nodes: readonly Node[]
}

const isToolNode = (
  node: Pick<Node, 'id' | 'data'>,
): node is Pick<Node<ToolNodeType>, 'id' | 'data'> => node.data.type === BlockEnum.Tool

export const getTestCredentialNodes = (nodes: readonly Node[]) =>
  nodes.filter(
    (node): node is Node<ToolNodeType> =>
      isToolNode(node) && node.data.credential_source === ToolCredentialSource.EndUser,
  )

export const resolveToolAuthorization = ({
  node,
  nodes,
}: ResolveToolAuthorizationParams): ToolAuthorizationResolution | undefined => {
  if (!isToolNode(node)) return undefined

  let source = node
  if (getToolAuthorizationTab(node.data) === 'reuse-from-node') {
    const sourceId = node.data.reuse_node_id
    if (!sourceId) return { status: 'invalid', reason: 'unselected' }
    if (sourceId === node.id) return { status: 'invalid', reason: 'cycle' }
    const target = nodes.find((item) => item.id === sourceId)
    if (!target) return { status: 'invalid', reason: 'missing' }
    if (
      !isToolNode(target) ||
      target.data.provider_type !== node.data.provider_type ||
      target.data.provider_id !== node.data.provider_id
    )
      return { status: 'invalid', reason: 'incompatible' }
    if (getToolAuthorizationTab(target.data) === 'reuse-from-node')
      return { status: 'invalid', reason: 'indirect' }
    source = target
  }

  if (getToolAuthorizationTab(source.data) === 'app-user-auth') {
    const draft = getAppUserAuthDraft(source.data)
    return {
      status: 'resolved',
      authorizationTab: 'app-user-auth',
      sourceNodeId: source.id,
      appUserDraft: { draft, errors: validateAppUserAuth(draft) },
    }
  }
  return { status: 'resolved', authorizationTab: 'workspace-auth', sourceNodeId: source.id }
}
