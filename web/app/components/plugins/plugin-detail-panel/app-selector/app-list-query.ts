import { consoleQuery } from '@/service/console'

export function appListOptions(name = '') {
  return consoleQuery.apps.get.infiniteOptions({
    input: (pageParam) => ({
      query: { page: Number(pageParam), limit: 20, name },
    }),
    getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
    initialPageParam: 1,
  })
}
