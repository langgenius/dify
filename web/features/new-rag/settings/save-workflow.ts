import type {
  KnowledgeFsExternalAccessPayload,
  KnowledgeFsMembersReplacePayload,
  KnowledgeFsSettingsPayload,
  KnowledgeFsSpaceUpdatePayload,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { KnowledgeSettingsDraft, KnowledgeSettingsSnapshot } from './draft'
import { settingsDraftFromSnapshot } from './draft'
import { modelFingerprint, modelPayload, retrievalFingerprint } from './model'

export type SettingsSaveStep = 'space' | 'members' | 'external' | 'embedding' | 'retrieval'

export type SettingsMigrationProgress = {
  id: string
  step: 'embedding' | 'retrieval'
  fingerprint: string
}

const memberFingerprint = (ids: string[]) => JSON.stringify([...ids].sort())

export function settingsStepFingerprint(
  draft: KnowledgeSettingsDraft,
  step: SettingsMigrationProgress['step'],
) {
  return step === 'embedding'
    ? modelFingerprint(draft.retrieval.embeddingModel)
    : retrievalFingerprint(draft.retrieval)
}

/** Carry only unsaved field intent forward; untouched fields follow the fresh server snapshot. */
export function rebaseSettingsDraft(
  draft: KnowledgeSettingsDraft,
  previous: KnowledgeSettingsSnapshot,
  next: KnowledgeSettingsSnapshot,
  completed: SettingsSaveStep[] = [],
): KnowledgeSettingsDraft {
  const original = settingsDraftFromSnapshot(previous)
  const fresh = settingsDraftFromSnapshot(next)
  const keepSpace = !completed.includes('space')
  const keepRetrieval = !completed.includes('retrieval')
  return {
    basic: {
      name:
        keepSpace && draft.basic.name.trim() !== original.basic.name
          ? draft.basic.name
          : fresh.basic.name,
      description:
        keepSpace && draft.basic.description !== original.basic.description
          ? draft.basic.description
          : fresh.basic.description,
      icon:
        keepSpace && draft.basic.icon !== original.basic.icon ? draft.basic.icon : fresh.basic.icon,
      iconBackground:
        keepSpace && draft.basic.iconBackground !== original.basic.iconBackground
          ? draft.basic.iconBackground
          : fresh.basic.iconBackground,
      visibility:
        keepSpace && draft.basic.visibility !== original.basic.visibility
          ? draft.basic.visibility
          : fresh.basic.visibility,
      selectedMemberIds:
        !completed.includes('members') &&
        memberFingerprint(draft.basic.selectedMemberIds) !==
          memberFingerprint(original.basic.selectedMemberIds)
          ? draft.basic.selectedMemberIds
          : fresh.basic.selectedMemberIds,
    },
    external: {
      apiEnabled:
        !completed.includes('external') &&
        draft.external.apiEnabled !== original.external.apiEnabled
          ? draft.external.apiEnabled
          : fresh.external.apiEnabled,
      workflowEnabled:
        !completed.includes('external') &&
        draft.external.workflowEnabled !== original.external.workflowEnabled
          ? draft.external.workflowEnabled
          : fresh.external.workflowEnabled,
    },
    retrieval: {
      embeddingModel:
        !completed.includes('embedding') &&
        modelFingerprint(draft.retrieval.embeddingModel) !==
          modelFingerprint(original.retrieval.embeddingModel)
          ? draft.retrieval.embeddingModel
          : fresh.retrieval.embeddingModel,
      reasoningModel:
        keepRetrieval &&
        modelFingerprint(draft.retrieval.reasoningModel) !==
          modelFingerprint(original.retrieval.reasoningModel)
          ? draft.retrieval.reasoningModel
          : fresh.retrieval.reasoningModel,
      rerankModel:
        keepRetrieval &&
        modelFingerprint(draft.retrieval.rerankModel) !==
          modelFingerprint(original.retrieval.rerankModel)
          ? draft.retrieval.rerankModel
          : fresh.retrieval.rerankModel,
      retrievalMode:
        keepRetrieval && draft.retrieval.retrievalMode !== original.retrieval.retrievalMode
          ? draft.retrieval.retrievalMode
          : fresh.retrieval.retrievalMode,
      scoreThreshold:
        keepRetrieval && draft.retrieval.scoreThreshold !== original.retrieval.scoreThreshold
          ? draft.retrieval.scoreThreshold
          : fresh.retrieval.scoreThreshold,
      scoreThresholdEnabled:
        keepRetrieval &&
        draft.retrieval.scoreThresholdEnabled !== original.retrieval.scoreThresholdEnabled
          ? draft.retrieval.scoreThresholdEnabled
          : fresh.retrieval.scoreThresholdEnabled,
      topK:
        keepRetrieval && draft.retrieval.topK !== original.retrieval.topK
          ? draft.retrieval.topK
          : fresh.retrieval.topK,
    },
  }
}

export function settingsSpacePayload(
  draft: KnowledgeSettingsDraft,
  baseline: KnowledgeSettingsSnapshot,
): KnowledgeFsSpaceUpdatePayload {
  const original = settingsDraftFromSnapshot(baseline).basic
  const current = draft.basic
  return {
    ...(current.name.trim() !== original.name && { name: current.name.trim() }),
    ...(current.description !== original.description && { description: current.description }),
    ...(current.icon !== original.icon && { icon: current.icon }),
    ...(current.iconBackground !== original.iconBackground && {
      icon_background: current.iconBackground,
    }),
    ...(baseline.space.permission_keys.includes('knowledge_space_access_config') &&
      current.visibility !== original.visibility && { visibility: current.visibility }),
  }
}

export function settingsMembersPayload(
  draft: KnowledgeSettingsDraft,
  baseline: KnowledgeSettingsSnapshot,
): KnowledgeFsMembersReplacePayload {
  return {
    members: draft.basic.selectedMemberIds
      .filter((id) => id !== baseline.space.owner_account_id)
      .map((account_id) => ({
        account_id,
        role:
          baseline.permissions.find(
            (permission) => permission.account_id === account_id && permission.status === 'active',
          )?.role ?? 'viewer',
      })),
  }
}

export function settingsExternalPayload(
  draft: KnowledgeSettingsDraft,
  baseline: KnowledgeSettingsSnapshot,
): KnowledgeFsExternalAccessPayload {
  const original = baseline.externalAccess
  const apiChanged =
    draft.external.apiEnabled !== settingsDraftFromSnapshot(baseline).external.apiEnabled
  return {
    agent_enabled: apiChanged ? draft.external.apiEnabled : (original?.agent_enabled ?? false),
    service_api_enabled: apiChanged
      ? draft.external.apiEnabled
      : (original?.service_api_enabled ?? false),
    workflow_enabled: draft.external.workflowEnabled,
    mcp_enabled: original?.mcp_enabled ?? false,
  }
}

export function settingsModelsPayload(
  draft: KnowledgeSettingsDraft,
  baseline: KnowledgeSettingsSnapshot,
  steps: SettingsSaveStep[],
): KnowledgeFsSettingsPayload {
  const current = draft.retrieval
  const payload: KnowledgeFsSettingsPayload = { expectedRevision: baseline.settings.revision }
  if (steps.includes('embedding')) {
    if (!current.embeddingModel) throw new Error('Missing embedding model')
    payload.embedding = modelPayload(current.embeddingModel)
  }
  if (steps.includes('retrieval')) {
    if (!current.reasoningModel || !current.rerankModel) throw new Error('Missing retrieval models')
    payload.retrieval = {
      defaultMode: current.retrievalMode,
      reasoningModel: modelPayload(current.reasoningModel),
      rerank: { enabled: true, model: modelPayload(current.rerankModel) },
      scoreThreshold: {
        enabled: current.scoreThresholdEnabled,
        stage: current.retrievalMode === 'research' ? 'mode-final' : 'rerank',
        value: current.scoreThreshold,
      },
      topK: current.topK,
    }
  }
  return payload
}
