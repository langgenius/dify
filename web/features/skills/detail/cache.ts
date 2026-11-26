import type { SkillDetailResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/console'
import { invalidateSkillVersionQueries } from '@/service/console/policies/skills'
import { setSkillDetailCache as writeSkillDetailCache } from '@/service/console/skill-cache'

export function invalidateSkillDetail(queryClient: QueryClient, skillId: string) {
  void invalidateSkillVersionQueries(consoleQuery, queryClient, skillId)
}

export function setSkillDetailCache(
  queryClient: QueryClient,
  skillId: string,
  detail: SkillDetailResponse,
) {
  writeSkillDetailCache(consoleQuery, queryClient, skillId, detail)
}

function refetchSkillDetail(skillId: string) {
  return consoleClient.workspaces.current.skills.bySkillId.get({
    params: {
      skill_id: skillId,
    },
  })
}

export async function refreshSkillDetailAfterConflict(
  queryClient: QueryClient,
  skillId: string,
  options: { updateCache?: boolean } = {},
) {
  const detail = await refetchSkillDetail(skillId)
  if (options.updateCache !== false) setSkillDetailCache(queryClient, skillId, detail)
  return detail
}
