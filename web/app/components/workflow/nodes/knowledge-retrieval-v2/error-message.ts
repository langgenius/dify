type KnowledgeRetrievalV2ErrorTranslationKey =
  | 'nodes.knowledgeRetrievalV2.errors.bindingNotEnabled'
  | 'nodes.knowledgeRetrievalV2.errors.permissionsNotReady'
  | 'nodes.knowledgeRetrievalV2.errors.spaceUnavailable'
  | 'nodes.knowledgeRetrievalV2.errors.workflowAccessDisabled'

type WorkflowTranslate = (key: KnowledgeRetrievalV2ErrorTranslationKey) => string

const BINDING_NOT_ENABLED_MARKER = '[knowledge_fs_binding_not_enabled]'
const WORKFLOW_ACCESS_DISABLED_MARKER = '[knowledge_fs_workflow_access_disabled]'
const SPACE_UNAVAILABLE_MARKER = '[knowledge_fs_space_unavailable]'
const AUTHORIZATION_NOT_READY_MARKER = '[knowledge_fs_authorization_not_ready]'

export const localizeKnowledgeRetrievalV2Error = (
  error: string | undefined,
  t: WorkflowTranslate,
) => {
  if (!error) return error
  if (error.includes(BINDING_NOT_ENABLED_MARKER))
    return t('nodes.knowledgeRetrievalV2.errors.bindingNotEnabled')
  if (error.includes(WORKFLOW_ACCESS_DISABLED_MARKER))
    return t('nodes.knowledgeRetrievalV2.errors.workflowAccessDisabled')
  if (error.includes(SPACE_UNAVAILABLE_MARKER))
    return t('nodes.knowledgeRetrievalV2.errors.spaceUnavailable')
  if (error.includes(AUTHORIZATION_NOT_READY_MARKER))
    return t('nodes.knowledgeRetrievalV2.errors.permissionsNotReady')
  return error
}
