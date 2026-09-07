import type { SkillResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ActionItem, SkillSearchResult } from './types'
import { getI18n } from 'react-i18next'
import { consoleQuery } from '@/service/client'

function getSkillResults(skills: SkillResponse[]): SkillSearchResult[] {
  return skills.map((skill) => ({
    id: skill.id,
    title: skill.display_name || skill.name,
    description: skill.description || undefined,
    type: 'skill' as const,
    path: `/skills/${skill.id}`,
    icon: (
      <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] border-divider-regular bg-background-default">
        <span aria-hidden className="i-custom-vender-main-nav-skill size-4.5 text-text-secondary" />
      </div>
    ),
    data: skill,
  }))
}

export const skillAction: ActionItem = {
  key: '@skill',
  shortcut: '@skill',
  get title() {
    return getI18n().t(($) => $['skillManagement.title'], { ns: 'skill' })
  },
  get description() {
    return getI18n().t(($) => $['skillManagement.searchLabel'], { ns: 'skill' })
  },
  source: 'remote',
}

export function skillSearchQueryOptions(searchTerm: string) {
  return consoleQuery.workspaces.current.skills.get.queryOptions({
    input: {
      query: {
        page: 1,
        limit: 10,
        keyword: searchTerm,
      },
    },
    retry: false,
    select: (response) => getSkillResults(response.data ?? []),
  })
}
