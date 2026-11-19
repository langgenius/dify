import type {
  KnowledgeFsProductPermission,
  KnowledgeFsSpaceDetailResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { KnowledgeSpaceContext } from '@/features/new-rag/space/context'

const allKnowledgeSpacePermissions: KnowledgeFsProductPermission[] = [
  'knowledge_space_access_config',
  'knowledge_space_create',
  'knowledge_space_delete',
  'knowledge_space_document_write',
  'knowledge_space_edit',
  'knowledge_space_query',
  'knowledge_space_read',
]

/** An active knowledge space the signed-in member can fully manage. */
export const createKnowledgeSpaceFixture = (
  overrides: Partial<KnowledgeFsSpaceDetailResponse> = {},
): KnowledgeFsSpaceDetailResponse => ({
  control_space_id: 'space-1',
  created_at: '2026-07-20T10:00:00Z',
  knowledge_space_id: 'knowledge-space-1',
  owner_account_id: 'account-1',
  permission_keys: allKnowledgeSpacePermissions,
  resource_version: 1,
  state: 'active',
  technical_status: 'available',
  technical_summary: {
    description: null,
    document_count: 0,
    knowledge_space_id: 'knowledge-space-1',
    name: 'Support knowledge',
    revision: 1,
    slug: 'support-knowledge',
  },
  updated_at: '2026-07-20T10:00:00Z',
  visibility: 'only_me',
  ...overrides,
})

/** Supplies the space that the knowledge-space shell normally loads for its child pages. */
export function KnowledgeSpaceTestProvider({
  children,
  refetch = async () => undefined,
  space = createKnowledgeSpaceFixture(),
}: {
  children: ReactNode
  refetch?: () => Promise<KnowledgeFsSpaceDetailResponse | undefined>
  space?: KnowledgeFsSpaceDetailResponse
}) {
  return createElement(KnowledgeSpaceContext, { value: { refetch, space } }, children)
}
