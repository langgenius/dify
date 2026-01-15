import { consoleClient, consoleQuery, marketplaceClient, marketplaceQuery } from '@/service/client'

export const searchAppsQueryKey = consoleQuery.gotoAnything.searchApps.queryKey

export const searchApps = async (name?: string) => {
  return consoleClient.gotoAnything.searchApps({
    query: {
      page: 1,
      name,
    },
  })
}

export const searchDatasetsQueryKey = consoleQuery.gotoAnything.searchDatasets.queryKey

export const searchDatasets = async (keyword?: string) => {
  return consoleClient.gotoAnything.searchDatasets({
    query: {
      page: 1,
      limit: 10,
      keyword,
    },
  })
}

export const searchPluginsQueryKey = marketplaceQuery.searchAdvanced.queryKey

export const searchPlugins = async (query?: string) => {
  return marketplaceClient.searchAdvanced({
    params: {
      kind: 'plugins',
    },
    body: {
      query: query || '',
      page: 1,
      page_size: 10,
    },
  })
}
