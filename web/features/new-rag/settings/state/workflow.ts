import type { QueryClient } from '@tanstack/react-query'
import type { KnowledgeSettingsSnapshot } from '../draft'
import type { SettingsMigrationProgress, SettingsSaveStep } from '../save-workflow'
import { atom } from 'jotai'
import { atomWithMutation, queryClientAtom } from 'jotai-tanstack-query'
import { consoleQuery } from '@/service/console'
import { settingsDraftChanges } from '../draft'
import { settingsSaveErrorMessageKey } from '../save-error'
import {
  rebaseSettingsDraft,
  settingsExternalPayload,
  settingsMembersPayload,
  settingsModelsPayload,
  settingsSpacePayload,
  settingsStepFingerprint,
} from '../save-workflow'
import {
  knowledgeSettingsCanSaveAtom,
  knowledgeSettingsEditSessionAtom,
  knowledgeSettingsHasConflictAtom,
} from './draft'
import { knowledgeSettingsSpaceIdAtom } from './inputs'

type SaveErrorKey = Awaited<ReturnType<typeof settingsSaveErrorMessageKey>>
export type KnowledgeSettingsSaveResult = {
  status: 'saved' | 'failed' | 'skipped' | 'reset'
  errorKey?: SaveErrorKey
}

const pendingSaveOwnersAtom = atom<Set<string>>(new globalThis.Set<string>())
const pendingMigrationAtom = atom<SettingsMigrationProgress | undefined>(undefined)
export const knowledgeSettingsSaveErrorAtom = atom<SaveErrorKey | undefined>(undefined)
export const knowledgeSettingsScopedAtoms = [
  pendingSaveOwnersAtom,
  pendingMigrationAtom,
  knowledgeSettingsSaveErrorAtom,
] as const
export const knowledgeSettingsHasPendingSaveAtom = atom(
  (get) => get(pendingSaveOwnersAtom).size > 0,
)
export const knowledgeSettingsInteractionLockedAtom = atom(
  (get) =>
    get(knowledgeSettingsHasPendingSaveAtom) ||
    Boolean(get(pendingMigrationAtom)) ||
    get(knowledgeSettingsHasConflictAtom) ||
    get(knowledgeSettingsSaveErrorAtom) === 'settings.revisionConflict',
)
export const knowledgeSettingsCanSubmitAtom = atom(
  (get) =>
    !get(knowledgeSettingsHasPendingSaveAtom) &&
    !get(knowledgeSettingsHasConflictAtom) &&
    get(knowledgeSettingsSaveErrorAtom) !== 'settings.revisionConflict' &&
    (get(knowledgeSettingsCanSaveAtom) || Boolean(get(pendingMigrationAtom))),
)
export const setKnowledgeSettingsSavePendingAtom = atom(
  null,
  (_get, set, { owner, pending }: { owner: string; pending: boolean }) => {
    set(pendingSaveOwnersAtom, (current) => {
      const owners = new globalThis.Set(current)
      if (pending) owners.add(owner)
      else owners.delete(owner)
      return owners
    })
  },
)

const spaceApi = consoleQuery.knowledgeFs.spaces.byControlSpaceId
const saveSpaceMutationAtom = atomWithMutation(() =>
  spaceApi.patch.mutationOptions({ retry: false, context: { silent: true } }),
)
const saveMembersMutationAtom = atomWithMutation(() =>
  spaceApi.members.put.mutationOptions({ retry: false, context: { silent: true } }),
)
const saveExternalMutationAtom = atomWithMutation(() =>
  spaceApi.externalAccess.put.mutationOptions({ retry: false, context: { silent: true } }),
)
const saveSettingsMutationAtom = atomWithMutation(() =>
  spaceApi.settings.patch.mutationOptions({ retry: false, context: { silent: true } }),
)

function snapshotQueries(control_space_id: string) {
  const options = {
    input: { params: { control_space_id } },
    staleTime: 0,
    retry: false as const,
    context: { silent: true },
  }
  return {
    space: spaceApi.get.queryOptions(options),
    settings: spaceApi.settings.get.queryOptions(options),
    permissions: spaceApi.permissions.get.queryOptions(options),
    externalAccess: spaceApi.externalAccess.get.queryOptions(options),
  }
}

async function freshSnapshot(
  queryClient: QueryClient,
  spaceId: string,
): Promise<KnowledgeSettingsSnapshot> {
  const queries = snapshotQueries(spaceId)
  await Promise.all(
    Object.values(queries).map((query) => queryClient.cancelQueries({ queryKey: query.queryKey })),
  )
  const [space, settings] = await Promise.all([
    queryClient.query(queries.space),
    queryClient.query(queries.settings),
  ])
  if (!space.permission_keys.includes('knowledge_space_access_config'))
    return { space, settings, permissions: [] }
  const [permissions, externalAccess] = await Promise.all([
    queryClient.query(queries.permissions),
    queryClient.query(queries.externalAccess),
  ])
  return { space, settings, permissions: permissions.data, externalAccess }
}

export const saveKnowledgeSettingsAtom = atom(
  null,
  async (get, set): Promise<KnowledgeSettingsSaveResult> => {
    const original = get(knowledgeSettingsEditSessionAtom)
    if (!original || get(knowledgeSettingsHasPendingSaveAtom)) return { status: 'skipped' }
    if (
      get(knowledgeSettingsHasConflictAtom) ||
      get(knowledgeSettingsSaveErrorAtom) === 'settings.revisionConflict'
    ) {
      set(knowledgeSettingsSaveErrorAtom, 'settings.revisionConflict')
      return { status: 'failed', errorKey: 'settings.revisionConflict' }
    }
    if (!get(knowledgeSettingsCanSaveAtom) && !get(pendingMigrationAtom))
      return { status: 'skipped' }
    const spaceId = get(knowledgeSettingsSpaceIdAtom)
    // Complete the submitted snapshot for this space even if its settings page unmounts.
    const params = { control_space_id: spaceId }
    const queryClient = get(queryClientAtom)
    const queries = snapshotQueries(spaceId)
    let session = { ...structuredClone(original), saveAttempted: true }
    const checkpoint = (
      baseline: KnowledgeSettingsSnapshot,
      completed: SettingsSaveStep[] = [],
    ) => {
      session = {
        ...session,
        baseline,
        draft: rebaseSettingsDraft(session.draft, session.baseline, baseline, completed),
      }
      set(knowledgeSettingsEditSessionAtom, session)
    }
    const refreshSettings = async () => {
      await queryClient.cancelQueries({ queryKey: queries.settings.queryKey })
      return queryClient.query(queries.settings)
    }
    const waitForMigration = async (progress: SettingsMigrationProgress) => {
      for (;;) {
        const migration = await queryClient.query(
          spaceApi.settings.migrations.byMigrationId.get.queryOptions({
            input: { params: { ...params, migration_id: progress.id } },
            staleTime: 0,
            retry: false,
            context: { silent: true },
          }),
        )
        if (migration.run_state === 'succeeded') {
          const settings = await refreshSettings()
          checkpoint(
            { ...session.baseline, settings },
            settingsStepFingerprint(session.draft, progress.step) === progress.fingerprint
              ? [progress.step]
              : [],
          )
          set(pendingMigrationAtom, undefined)
          return
        }
        if (migration.run_state === 'failed' || migration.run_state === 'canceled') {
          set(pendingMigrationAtom, undefined)
          throw new Error('Settings profile migration failed')
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 2000))
      }
    }
    const saveModels = async (steps: SettingsSaveStep[]) => {
      const response = await get(saveSettingsMutationAtom).mutateAsync({
        params,
        body: settingsModelsPayload(session.draft, session.baseline, steps),
      })
      await queryClient.cancelQueries({ queryKey: queries.settings.queryKey })
      queryClient.setQueryData(queries.settings.queryKey, response.settings)
      if (response.migration) {
        const step = response.migration.changed_kind
        const progress = {
          id: response.migration.id,
          step,
          fingerprint: settingsStepFingerprint(session.draft, step),
        }
        set(pendingMigrationAtom, progress)
        checkpoint({ ...session.baseline, settings: response.settings })
        await waitForMigration(progress)
      } else checkpoint({ ...session.baseline, settings: response.settings }, steps)
    }
    set(knowledgeSettingsEditSessionAtom, session)
    set(knowledgeSettingsSaveErrorAtom, undefined)
    set(setKnowledgeSettingsSavePendingAtom, { owner: 'save', pending: true })
    try {
      const migration = get(pendingMigrationAtom)
      if (migration) await waitForMigration(migration)
      let changes = settingsDraftChanges(session.draft, session.baseline)
      const hasActiveProfile =
        typeof session.baseline.settings.active_profile_revisions.embedding === 'number' ||
        typeof session.baseline.settings.active_profile_revisions.retrieval === 'number'
      if (!hasActiveProfile && (changes.embedding || changes.retrieval)) {
        await saveModels([
          ...(changes.embedding ? ['embedding' as const] : []),
          ...(changes.retrieval ? ['retrieval' as const] : []),
        ])
      } else {
        if (changes.embedding) await saveModels(['embedding'])
        changes = settingsDraftChanges(session.draft, session.baseline)
        if (changes.retrieval) await saveModels(['retrieval'])
      }
      if (settingsDraftChanges(session.draft, session.baseline).space) {
        const space = await get(saveSpaceMutationAtom).mutateAsync({
          params,
          body: settingsSpacePayload(session.draft, session.baseline),
        })
        await queryClient.cancelQueries({ queryKey: queries.space.queryKey })
        queryClient.setQueryData(queries.space.queryKey, space)
        checkpoint({ ...session.baseline, space }, ['space'])
      }
      if (settingsDraftChanges(session.draft, session.baseline).members) {
        const permissions = await get(saveMembersMutationAtom).mutateAsync({
          params,
          body: settingsMembersPayload(session.draft, session.baseline),
        })
        await queryClient.cancelQueries({ queryKey: queries.permissions.queryKey })
        queryClient.setQueryData(queries.permissions.queryKey, permissions)
        checkpoint({ ...session.baseline, permissions: permissions.data }, ['members'])
      }
      if (settingsDraftChanges(session.draft, session.baseline).external) {
        const externalAccess = await get(saveExternalMutationAtom).mutateAsync({
          params,
          body: settingsExternalPayload(session.draft, session.baseline),
        })
        await queryClient.cancelQueries({ queryKey: queries.externalAccess.queryKey })
        queryClient.setQueryData(queries.externalAccess.queryKey, externalAccess)
        checkpoint({ ...session.baseline, externalAccess }, ['external'])
      }
      set(knowledgeSettingsEditSessionAtom, undefined)
      return { status: 'saved' }
    } catch (error) {
      const errorKey = await settingsSaveErrorMessageKey(error)
      try {
        const snapshot = await freshSnapshot(queryClient, spaceId)
        // A CAS failure needs an explicit reload, never a blind retry against a newer revision.
        if (errorKey !== 'settings.revisionConflict') checkpoint(snapshot)
      } catch {
        /* Keep the prior baseline and draft if recovery reads fail. */
      }
      set(knowledgeSettingsSaveErrorAtom, errorKey)
      return { status: 'failed', errorKey }
    } finally {
      set(setKnowledgeSettingsSavePendingAtom, { owner: 'save', pending: false })
    }
  },
)

export const resetKnowledgeSettingsDraftAtom = atom(
  null,
  async (get, set): Promise<KnowledgeSettingsSaveResult> => {
    if (get(knowledgeSettingsHasPendingSaveAtom)) return { status: 'skipped' }
    const spaceId = get(knowledgeSettingsSpaceIdAtom)
    set(setKnowledgeSettingsSavePendingAtom, { owner: 'reset', pending: true })
    try {
      await freshSnapshot(get(queryClientAtom), spaceId)
      set(knowledgeSettingsEditSessionAtom, undefined)
      set(pendingMigrationAtom, undefined)
      set(knowledgeSettingsSaveErrorAtom, undefined)
      return { status: 'reset' }
    } catch (error) {
      const errorKey = await settingsSaveErrorMessageKey(error)
      set(knowledgeSettingsSaveErrorAtom, errorKey)
      return { status: 'failed', errorKey }
    } finally {
      set(setKnowledgeSettingsSavePendingAtom, { owner: 'reset', pending: false })
    }
  },
)
