import type {
  BasicInformationDraft,
  KnowledgeSettingsDraft,
  KnowledgeSettingsSnapshot,
} from '../draft'
import type { ExternalAccessDraft, RetrievalSettingsDraft } from '../model'
import { atom } from 'jotai'
import { KNOWLEDGE_DESCRIPTION_MAX_LENGTH, KNOWLEDGE_NAME_MAX_LENGTH } from '../../constants'
import {
  settingsDraftChanges,
  settingsDraftFromSnapshot,
  settingsDraftsMatch,
  settingsSnapshotVersion,
} from '../draft'
import { SCORE_THRESHOLD_MAX, SCORE_THRESHOLD_MIN, TOP_K_MAX, TOP_K_MIN } from '../model'
import {
  knowledgeSettingsExternalAccessAtom,
  knowledgeSettingsHasDataAtom,
  knowledgeSettingsPermissionsAtom,
  knowledgeSettingsSettingsAtom,
  knowledgeSettingsSpaceAtom,
} from './queries'

export const knowledgeSettingsEditSessionAtom = atom<
  | {
      baseline: KnowledgeSettingsSnapshot
      draft: KnowledgeSettingsDraft
      saveAttempted?: boolean
    }
  | undefined
>(undefined)

export const knowledgeSettingsServerSnapshotAtom = atom(
  (get): KnowledgeSettingsSnapshot | undefined => {
    const space = get(knowledgeSettingsSpaceAtom)
    const settings = get(knowledgeSettingsSettingsAtom)
    if (!space || !settings || !get(knowledgeSettingsHasDataAtom)) return undefined
    const canManageAccess = space.permission_keys.includes('knowledge_space_access_config')
    return {
      space,
      settings,
      permissions: canManageAccess ? get(knowledgeSettingsPermissionsAtom) : [],
      externalAccess: canManageAccess ? get(knowledgeSettingsExternalAccessAtom) : undefined,
    }
  },
)

const currentDraftAtom = atom((get) => {
  const session = get(knowledgeSettingsEditSessionAtom)
  if (session) return session.draft
  const snapshot = get(knowledgeSettingsServerSnapshotAtom)
  return snapshot ? settingsDraftFromSnapshot(snapshot) : undefined
})

export const knowledgeSettingsBasicDraftAtom = atom((get) => get(currentDraftAtom)?.basic)
export const knowledgeSettingsExternalDraftAtom = atom((get) => get(currentDraftAtom)?.external)
export const knowledgeSettingsRetrievalDraftAtom = atom((get) => get(currentDraftAtom)?.retrieval)

const updateDraftAtom = atom(null, (get, set, patch: Partial<KnowledgeSettingsDraft>) => {
  const session = get(knowledgeSettingsEditSessionAtom)
  const baseline = session?.baseline ?? get(knowledgeSettingsServerSnapshotAtom)
  if (!baseline) return
  const draft = { ...(session?.draft ?? settingsDraftFromSnapshot(baseline)), ...patch }
  set(
    knowledgeSettingsEditSessionAtom,
    !session?.saveAttempted && settingsDraftsMatch(draft, settingsDraftFromSnapshot(baseline))
      ? undefined
      : { ...session, baseline, draft },
  )
})

export const updateKnowledgeSettingsBasicDraftAtom = atom(
  null,
  (get, set, patch: Partial<BasicInformationDraft>) => {
    const current = get(knowledgeSettingsBasicDraftAtom)
    if (current) set(updateDraftAtom, { basic: { ...current, ...patch } })
  },
)
export const updateKnowledgeSettingsExternalDraftAtom = atom(
  null,
  (get, set, patch: Partial<ExternalAccessDraft>) => {
    const current = get(knowledgeSettingsExternalDraftAtom)
    if (current) set(updateDraftAtom, { external: { ...current, ...patch } })
  },
)
export const updateKnowledgeSettingsRetrievalDraftAtom = atom(
  null,
  (get, set, patch: Partial<RetrievalSettingsDraft>) => {
    const current = get(knowledgeSettingsRetrievalDraftAtom)
    if (current) set(updateDraftAtom, { retrieval: { ...current, ...patch } })
  },
)

export const knowledgeSettingsHasDraftAtom = atom((get) => {
  const session = get(knowledgeSettingsEditSessionAtom)
  return session !== undefined
})

export const knowledgeSettingsHasConflictAtom = atom((get) => {
  const session = get(knowledgeSettingsEditSessionAtom)
  const latest = get(knowledgeSettingsServerSnapshotAtom)
  return Boolean(
    session &&
    latest &&
    settingsSnapshotVersion(session.baseline) !== settingsSnapshotVersion(latest),
  )
})

export const knowledgeSettingsValidationAtom = atom((get) => {
  const current = get(currentDraftAtom)
  const session = get(knowledgeSettingsEditSessionAtom)
  const snapshot = session?.baseline ?? get(knowledgeSettingsServerSnapshotAtom)
  if (!current || !snapshot)
    return {
      nameInvalid: false,
      descriptionInvalid: false,
      membersInvalid: false,
      retrievalInvalid: false,
    }
  const changes = settingsDraftChanges(current, snapshot)
  const hasActiveProfile =
    typeof snapshot.settings.active_profile_revisions.embedding === 'number' ||
    typeof snapshot.settings.active_profile_revisions.retrieval === 'number'
  return {
    nameInvalid:
      !current.basic.name.trim() ||
      Array.from(current.basic.name.trim()).length > KNOWLEDGE_NAME_MAX_LENGTH,
    descriptionInvalid:
      Array.from(current.basic.description).length > KNOWLEDGE_DESCRIPTION_MAX_LENGTH,
    membersInvalid:
      snapshot.space.permission_keys.includes('knowledge_space_access_config') &&
      current.basic.visibility === 'partial_members' &&
      current.basic.selectedMemberIds.length === 0,
    retrievalInvalid:
      (changes.embedding && !current.retrieval.embeddingModel) ||
      (changes.retrieval &&
        (!current.retrieval.reasoningModel ||
          !current.retrieval.rerankModel ||
          (!hasActiveProfile && !current.retrieval.embeddingModel))) ||
      ((changes.embedding || changes.retrieval) &&
        (!Number.isFinite(current.retrieval.topK) ||
          !Number.isInteger(current.retrieval.topK) ||
          current.retrieval.topK < TOP_K_MIN ||
          current.retrieval.topK > TOP_K_MAX ||
          !Number.isFinite(current.retrieval.scoreThreshold) ||
          current.retrieval.scoreThreshold < SCORE_THRESHOLD_MIN ||
          current.retrieval.scoreThreshold > SCORE_THRESHOLD_MAX)),
  }
})

export const knowledgeSettingsCanSaveAtom = atom((get) => {
  const session = get(knowledgeSettingsEditSessionAtom)
  if (!session || get(knowledgeSettingsHasConflictAtom)) return false
  const changes = settingsDraftChanges(session.draft, session.baseline)
  const validation = get(knowledgeSettingsValidationAtom)
  return (
    changes.any &&
    !(changes.space && (validation.nameInvalid || validation.descriptionInvalid)) &&
    !validation.membersInvalid &&
    !validation.retrievalInvalid
  )
})
