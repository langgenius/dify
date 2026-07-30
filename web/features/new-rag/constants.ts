import type { KnowledgeFsSettingsResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'

export const KNOWLEDGE_NAME_MAX_LENGTH = 40
export const KNOWLEDGE_DESCRIPTION_MAX_LENGTH = 2000

export function isKnowledgeModelSetupReady(
  configurationState: KnowledgeFsSettingsResponse['configuration_state'],
) {
  return configurationState === 'active' || configurationState === 'pending-validation'
}
