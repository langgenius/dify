import { localizeKnowledgeRetrievalV2Error } from '../error-message'

const t = (key: string) => key

describe('knowledge-retrieval-v2/error-message', () => {
  it.each([
    [
      '[knowledge_fs_binding_not_enabled] fallback',
      'nodes.knowledgeRetrievalV2.errors.bindingNotEnabled',
    ],
    [
      '[knowledge_fs_workflow_access_disabled] fallback',
      'nodes.knowledgeRetrievalV2.errors.workflowAccessDisabled',
    ],
    [
      '[knowledge_fs_space_unavailable] fallback',
      'nodes.knowledgeRetrievalV2.errors.spaceUnavailable',
    ],
    [
      '[knowledge_fs_authorization_not_ready] fallback',
      'nodes.knowledgeRetrievalV2.errors.permissionsNotReady',
    ],
  ])('maps %s to %s', (error, expectedKey) => {
    expect(localizeKnowledgeRetrievalV2Error(error, t)).toBe(expectedKey)
  })

  it('preserves unrelated errors and missing values', () => {
    expect(localizeKnowledgeRetrievalV2Error('upstream failed', t)).toBe('upstream failed')
    expect(localizeKnowledgeRetrievalV2Error(undefined, t)).toBeUndefined()
  })
})
