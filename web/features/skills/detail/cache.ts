import type {
  SkillDetailResponse,
  SkillResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/console'

export function invalidateSkillDetail(queryClient: QueryClient, skillId: string) {
  void queryClient.invalidateQueries({
    queryKey: consoleQuery.workspaces.current.skills.bySkillId.get.key({
      type: 'query',
      input: {
        params: {
          skill_id: skillId,
        },
      },
    }),
  })
  void queryClient.invalidateQueries({
    queryKey: consoleQuery.workspaces.current.skills.bySkillId.versions.get.key({
      type: 'query',
      input: {
        params: {
          skill_id: skillId,
        },
      },
    }),
  })
  void queryClient.invalidateQueries({
    queryKey: consoleQuery.workspaces.current.agents.byAgentId.skills.get.key({ type: 'query' }),
  })
}

export function setSkillDetailCache(
  queryClient: QueryClient,
  skillId: string,
  detail: SkillDetailResponse,
) {
  queryClient.setQueryData(
    consoleQuery.workspaces.current.skills.bySkillId.get.key({
      type: 'query',
      input: {
        params: {
          skill_id: skillId,
        },
      },
    }),
    detail,
  )
  updateSkillListCache(queryClient, detail)
}

type SkillListCachePage = {
  data?: SkillResponse[]
}

function updateSkillListCache(queryClient: QueryClient, detail: SkillDetailResponse) {
  const updateSkill = (skill: SkillResponse): SkillResponse => {
    if (skill.id !== detail.id) return skill

    return {
      ...skill,
      description: detail.description,
      display_name: detail.display_name,
      icon: detail.icon,
      latest_published_at: detail.latest_published_at,
      latest_published_version_id: detail.latest_published_version_id,
      latest_published_version_number: detail.latest_published_version_number,
      name: detail.name,
      name_manually_edited: detail.name_manually_edited,
      reference_count: detail.reference_count,
      tags: detail.tags,
      updated_at: detail.updated_at,
      updated_by: detail.updated_by,
      updated_by_name: detail.updated_by_name,
    }
  }
  const updatePage = <TPage extends SkillListCachePage>(page: TPage): TPage => {
    if (!page.data?.some((skill) => skill.id === detail.id)) return page

    return {
      ...page,
      data: page.data.map(updateSkill),
    }
  }

  queryClient.setQueriesData<SkillListCachePage>(
    {
      queryKey: consoleQuery.workspaces.current.skills.get.key({ type: 'query' }),
    },
    (page) => (page ? updatePage(page) : page),
  )
  queryClient.setQueriesData<InfiniteData<SkillListCachePage>>(
    {
      queryKey: consoleQuery.workspaces.current.skills.get.key({ type: 'infinite' }),
    },
    (cache) =>
      cache
        ? {
            ...cache,
            pages: cache.pages.map(updatePage),
          }
        : cache,
  )
}

function refetchSkillDetail(skillId: string) {
  return consoleClient.workspaces.current.skills.bySkillId.get(
    {
      params: {
        skill_id: skillId,
      },
    },
    { context: { silent: true } },
  )
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
