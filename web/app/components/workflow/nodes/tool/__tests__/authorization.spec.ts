import type { Node } from '../../../types'
import type { ToolNodeType } from '../types'
import { CollectionType } from '@/app/components/tools/types'
import { createNode } from '../../../__tests__/fixtures'
import { BlockEnum } from '../../../types'
import { resolveToolAuthorization } from '../authorization'

const makeTool = (id: string, data: Partial<ToolNodeType> = {}) =>
  createNode({
    id,
    data: {
      type: BlockEnum.Tool,
      provider_id: 'google',
      provider_type: CollectionType.builtIn,
      provider_name: 'google',
      tool_name: 'search',
      tool_parameters: {},
      tool_configurations: {},
      ...data,
    },
  })

it('keeps legacy tool nodes on workspace authorization', () => {
  expect(resolveToolAuthorization({ node: makeTool('current'), nodes: [] })).toEqual({
    status: 'resolved',
    authorizationTab: 'workspace-auth',
    sourceNodeId: 'current',
  })
})

it('restores saved App user settings and validation without an editor draft', () => {
  const node = makeTool('current', {
    credential_source: 'end_user',
    end_user_auth: { allowed_credential_types: ['oauth2'], purpose: 'Read calendar' },
    test_credential_id: 'test-credential',
  })
  expect(resolveToolAuthorization({ node, nodes: [node] })).toMatchObject({
    status: 'resolved',
    authorizationTab: 'app-user-auth',
    sourceNodeId: 'current',
    appUserDraft: {
      draft: {
        oauthEnabled: true,
        apiKeyEnabled: false,
        description: 'Read calendar',
        testCredentialId: 'test-credential',
      },
      errors: { methods: false, oauthClient: true, description: false },
    },
  })
})

it('resolves Workspace authorization from another tool in the same provider', () => {
  const node = makeTool('current', { credential_source: 'reuse_node', reuse_node_id: 'source' })
  const source = makeTool('source', { tool_name: 'calendar' })
  expect(resolveToolAuthorization({ node, nodes: [node, source] })).toEqual({
    status: 'resolved',
    authorizationTab: 'workspace-auth',
    sourceNodeId: 'source',
  })
})

it('inherits App user settings and test credentials from another tool in the same provider', () => {
  const node = makeTool('current', { credential_source: 'reuse_node', reuse_node_id: 'source' })
  const source = makeTool('source', {
    tool_name: 'calendar',
    credential_source: 'end_user',
    end_user_auth: { allowed_credential_types: ['api-key'], purpose: 'Read calendar' },
    test_credential_id: 'source-credential',
  })
  expect(resolveToolAuthorization({ node, nodes: [node, source] })).toMatchObject({
    status: 'resolved',
    authorizationTab: 'app-user-auth',
    sourceNodeId: 'source',
    appUserDraft: {
      draft: { testCredentialId: 'source-credential' },
      errors: { methods: false, oauthClient: false, description: false },
    },
  })
})

it.each<{ name: string; sourceId?: string; nodes: Node[]; reason: string }>([
  { name: 'unselected source', nodes: [makeTool('source')], reason: 'unselected' },
  { name: 'deleted source', sourceId: 'source', nodes: [], reason: 'missing' },
  {
    name: 'changed provider ID',
    sourceId: 'source',
    nodes: [makeTool('source', { provider_id: 'another-provider' })],
    reason: 'incompatible',
  },
  {
    name: 'changed provider type',
    sourceId: 'source',
    nodes: [makeTool('source', { provider_type: CollectionType.custom })],
    reason: 'incompatible',
  },
  {
    name: 'indirect source',
    sourceId: 'middle',
    nodes: [
      makeTool('middle', { credential_source: 'reuse_node', reuse_node_id: 'source' }),
      makeTool('source'),
    ],
    reason: 'indirect',
  },
  { name: 'self reference', sourceId: 'current', nodes: [], reason: 'cycle' },
])('rejects a $name using the live graph', ({ sourceId, nodes, reason }) => {
  expect(
    resolveToolAuthorization({
      node: makeTool('current', { credential_source: 'reuse_node', reuse_node_id: sourceId }),
      nodes,
    }),
  ).toEqual({ status: 'invalid', reason })
})
