import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { selectAtom } from 'jotai/utils'
import { consoleQuery } from '@/service/client'
import { knowledgeSettingsSpaceIdAtom } from './inputs'

const spaceQueryAtom = atomWithQuery((get) =>
  consoleQuery.knowledgeFs.spaces.byControlSpaceId.get.queryOptions({
    input: { params: { control_space_id: get(knowledgeSettingsSpaceIdAtom) } },
  }),
)

const settingsQueryAtom = atomWithQuery((get) =>
  consoleQuery.knowledgeFs.spaces.byControlSpaceId.settings.get.queryOptions({
    input: { params: { control_space_id: get(knowledgeSettingsSpaceIdAtom) } },
  }),
)

export const knowledgeSettingsSpaceAtom = selectAtom(spaceQueryAtom, (query) => query.data)
export const knowledgeSettingsSettingsAtom = selectAtom(settingsQueryAtom, (query) => query.data)

export const knowledgeSettingsCanManageAccessAtom = atom(
  (get) =>
    get(knowledgeSettingsSpaceAtom)?.permission_keys.includes('knowledge_space_access_config') ??
    false,
)

const permissionsQueryAtom = atomWithQuery((get) => ({
  ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.permissions.get.queryOptions({
    input: { params: { control_space_id: get(knowledgeSettingsSpaceIdAtom) } },
  }),
  enabled: get(knowledgeSettingsCanManageAccessAtom),
}))

const externalAccessQueryAtom = atomWithQuery((get) => ({
  ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.externalAccess.get.queryOptions({
    input: { params: { control_space_id: get(knowledgeSettingsSpaceIdAtom) } },
  }),
  enabled: get(knowledgeSettingsCanManageAccessAtom),
}))

export const knowledgeSettingsPermissionsAtom = selectAtom(
  permissionsQueryAtom,
  (query) => query.data?.data ?? [],
)
export const knowledgeSettingsExternalAccessAtom = selectAtom(
  externalAccessQueryAtom,
  (query) => query.data,
)

export const knowledgeSettingsIsPendingAtom = atom((get) => {
  const canManageAccess = get(knowledgeSettingsCanManageAccessAtom)
  return (
    get(spaceQueryAtom).isPending ||
    get(settingsQueryAtom).isPending ||
    (canManageAccess &&
      (get(permissionsQueryAtom).isPending || get(externalAccessQueryAtom).isPending))
  )
})

export const knowledgeSettingsHasErrorAtom = atom((get) => {
  const canManageAccess = get(knowledgeSettingsCanManageAccessAtom)
  return (
    get(spaceQueryAtom).isError ||
    get(settingsQueryAtom).isError ||
    (canManageAccess && (get(permissionsQueryAtom).isError || get(externalAccessQueryAtom).isError))
  )
})

export const retryKnowledgeSettingsAtom = atom(null, async (get) => {
  const requests: Promise<unknown>[] = [
    get(spaceQueryAtom).refetch(),
    get(settingsQueryAtom).refetch(),
  ]
  if (get(knowledgeSettingsCanManageAccessAtom))
    requests.push(get(permissionsQueryAtom).refetch(), get(externalAccessQueryAtom).refetch())
  await Promise.all(requests)
})

export const invalidateKnowledgeSettingsAtom = atom(null, async (get) => {
  const requests: Promise<unknown>[] = [
    get(spaceQueryAtom).refetch(),
    get(settingsQueryAtom).refetch(),
  ]
  if (get(knowledgeSettingsCanManageAccessAtom))
    requests.push(get(permissionsQueryAtom).refetch(), get(externalAccessQueryAtom).refetch())
  await Promise.all(requests)
})
