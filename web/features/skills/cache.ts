import type { QueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'

export function invalidateSkillListQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({
    queryKey: consoleQuery.workspaces.current.skills.get.key({ type: 'query' }),
  })
  void queryClient.invalidateQueries({
    queryKey: consoleQuery.workspaces.current.skills.get.key({ type: 'infinite' }),
  })
  void queryClient.invalidateQueries({
    queryKey: consoleQuery.workspaces.current.skills.tags.get.key({ type: 'query' }),
  })
}
