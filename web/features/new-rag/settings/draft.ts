import type {
  KnowledgeFsControlSpaceVisibility,
  KnowledgeFsExternalAccessResponse,
  KnowledgeFsPermissionResponse,
  KnowledgeFsSettingsResponse,
  KnowledgeFsSpaceDetailResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { ExternalAccessDraft, RetrievalSettingsDraft } from './model'
import { DEFAULT_KNOWLEDGE_SPACE_ICON_BACKGROUND } from '../components/knowledge-space-icon'
import { modelFingerprint, retrievalDraftFromSettings, retrievalFingerprint } from './model'

export type BasicInformationDraft = {
  description: string
  icon: string
  iconBackground: string
  name: string
  selectedMemberIds: string[]
  visibility: KnowledgeFsControlSpaceVisibility
}

export type KnowledgeSettingsSnapshot = {
  space: KnowledgeFsSpaceDetailResponse
  settings: KnowledgeFsSettingsResponse
  permissions: KnowledgeFsPermissionResponse[]
  externalAccess?: KnowledgeFsExternalAccessResponse
}

export type KnowledgeSettingsDraft = {
  basic: BasicInformationDraft
  external: ExternalAccessDraft
  retrieval: RetrievalSettingsDraft
}

export function settingsDraftFromSnapshot({
  space,
  settings,
  permissions,
  externalAccess,
}: KnowledgeSettingsSnapshot): KnowledgeSettingsDraft {
  return {
    basic: {
      description: space.technical_summary?.description ?? '',
      icon: space.technical_summary?.icon ?? '📙',
      iconBackground:
        space.technical_summary?.icon_background ?? DEFAULT_KNOWLEDGE_SPACE_ICON_BACKGROUND,
      name: space.technical_summary?.name ?? '',
      selectedMemberIds: permissions
        .filter(
          ({ status, account_id }) => status === 'active' && account_id !== space.owner_account_id,
        )
        .map(({ account_id }) => account_id),
      visibility: space.visibility,
    },
    external: {
      apiEnabled: Boolean(externalAccess?.service_api_enabled && externalAccess.agent_enabled),
      workflowEnabled: externalAccess?.workflow_enabled ?? false,
    },
    retrieval: retrievalDraftFromSettings(settings),
  }
}

function memberIdsFingerprint(ids: string[]) {
  return JSON.stringify([...ids].sort())
}

export function settingsDraftsMatch(left: KnowledgeSettingsDraft, right: KnowledgeSettingsDraft) {
  return (
    left.basic.name === right.basic.name &&
    left.basic.description === right.basic.description &&
    left.basic.icon === right.basic.icon &&
    left.basic.iconBackground === right.basic.iconBackground &&
    left.basic.visibility === right.basic.visibility &&
    memberIdsFingerprint(left.basic.selectedMemberIds) ===
      memberIdsFingerprint(right.basic.selectedMemberIds) &&
    left.external.apiEnabled === right.external.apiEnabled &&
    left.external.workflowEnabled === right.external.workflowEnabled &&
    modelFingerprint(left.retrieval.embeddingModel) ===
      modelFingerprint(right.retrieval.embeddingModel) &&
    retrievalFingerprint(left.retrieval) === retrievalFingerprint(right.retrieval)
  )
}

export function settingsDraftChanges(
  draft: KnowledgeSettingsDraft,
  baseline: KnowledgeSettingsSnapshot,
) {
  const original = settingsDraftFromSnapshot(baseline)
  const canEdit = baseline.space.permission_keys.includes('knowledge_space_edit')
  const canManageAccess = baseline.space.permission_keys.includes('knowledge_space_access_config')
  const space =
    canEdit &&
    (draft.basic.name.trim() !== original.basic.name ||
      draft.basic.description !== original.basic.description ||
      draft.basic.icon !== original.basic.icon ||
      draft.basic.iconBackground !== original.basic.iconBackground ||
      (canManageAccess && draft.basic.visibility !== original.basic.visibility))
  const members =
    canManageAccess &&
    memberIdsFingerprint(draft.basic.selectedMemberIds) !==
      memberIdsFingerprint(original.basic.selectedMemberIds)
  const external =
    canManageAccess &&
    (draft.external.apiEnabled !== original.external.apiEnabled ||
      draft.external.workflowEnabled !== original.external.workflowEnabled)
  const embedding =
    canEdit &&
    modelFingerprint(draft.retrieval.embeddingModel) !==
      modelFingerprint(original.retrieval.embeddingModel)
  const retrieval =
    canEdit && retrievalFingerprint(draft.retrieval) !== retrievalFingerprint(original.retrieval)
  return {
    space,
    members,
    external,
    embedding,
    retrieval,
    any: space || members || external || embedding || retrieval,
  }
}

export function settingsSnapshotVersion(snapshot: KnowledgeSettingsSnapshot) {
  return JSON.stringify({
    space: snapshot.space.resource_version,
    settings: snapshot.settings.revision,
    external: snapshot.externalAccess?.revision,
    permissions: snapshot.permissions
      .map(
        ({ account_id, revision, status, role }) => `${account_id}:${revision}:${status}:${role}`,
      )
      .sort(),
    permissionKeys: [...snapshot.space.permission_keys].sort(),
  })
}
