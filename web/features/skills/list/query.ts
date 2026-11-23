'use client'

import type { QueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

function skillsListQueryKey(type: 'infinite' | 'query') {
  return consoleQuery.workspaces.current.skills.get.key({ type })
}

export function invalidateSkillListQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: skillsListQueryKey('query') })
  void queryClient.invalidateQueries({ queryKey: skillsListQueryKey('infinite') })
  void queryClient.invalidateQueries({
    queryKey: consoleQuery.workspaces.current.skills.tags.get.key({ type: 'query' }),
  })
}
