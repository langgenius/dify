import { describe, expect, it } from 'vite-plus/test'
import { workflowImports } from './generated/api/console/knowledge-fs/orpc.gen.ts'
import {
  zPostKnowledgeFsSpacesByControlSpaceIdSourcesBySourceIdWorkflowImportsBody,
  zPostKnowledgeFsSpacesByControlSpaceIdSourcesBySourceIdWorkflowImportsHeaders,
} from './generated/api/console/knowledge-fs/zod.gen.ts'

describe('generated KnowledgeFS durable source import contract', () => {
  it('exposes the workflow import operation and preserves the discriminated item bodies', () => {
    expect(workflowImports.post).toBeDefined()
    expect(
      zPostKnowledgeFsSpacesByControlSpaceIdSourcesBySourceIdWorkflowImportsBody.safeParse({
        kind: 'online-document-import',
        items: [
          {
            pageId: 'page-1',
            providerItemId: 'page-1',
            type: 'page',
            workspaceId: 'workspace-1',
          },
        ],
      }).success,
    ).toBe(true)
    expect(
      zPostKnowledgeFsSpacesByControlSpaceIdSourcesBySourceIdWorkflowImportsBody.safeParse({
        kind: 'online-drive-import',
        items: [
          {
            id: 'files/runbook.pdf',
            name: 'runbook.pdf',
            providerItemId: 'files/runbook.pdf',
          },
        ],
      }).success,
    ).toBe(true)
    expect(
      zPostKnowledgeFsSpacesByControlSpaceIdSourcesBySourceIdWorkflowImportsBody.safeParse({
        kind: 'online-drive-import',
        items: [
          {
            pageId: 'page-1',
            providerItemId: 'page-1',
            type: 'page',
            workspaceId: 'workspace-1',
          },
        ],
      }).success,
    ).toBe(false)
    expect(
      zPostKnowledgeFsSpacesByControlSpaceIdSourcesBySourceIdWorkflowImportsBody.safeParse({
        kind: 'online-document-import',
        items: [
          {
            lastEditedTime: 'x'.repeat(129),
            pageId: 'page-1',
            providerItemId: 'page-1',
            type: 'page',
            workspaceId: 'workspace-1',
          },
        ],
      }).success,
    ).toBe(false)
    expect(
      zPostKnowledgeFsSpacesByControlSpaceIdSourcesBySourceIdWorkflowImportsHeaders.safeParse({
        'Idempotency-Key': 'short-1',
      }).success,
    ).toBe(false)
    expect(
      zPostKnowledgeFsSpacesByControlSpaceIdSourcesBySourceIdWorkflowImportsHeaders.safeParse({
        'Idempotency-Key': 'import-1',
      }).success,
    ).toBe(true)
  })
})
