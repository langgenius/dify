import { cache } from 'react'
import { getQueryClient } from '@/app/get-query-client'
import { connection } from '@/next/server'
import { serverConsoleQuery } from '@/service/server'
import 'server-only'

export const getSystemFeaturesQueryClient = cache(getQueryClient)

const systemFeaturesServerQueryOptions = () => serverConsoleQuery.systemFeatures.get.queryOptions()

export const getCachedSystemFeatures = () => {
  const queryClient = getSystemFeaturesQueryClient()
  const queryOptions = systemFeaturesServerQueryOptions()
  return queryClient.getQueryData(queryOptions.queryKey)
}

export const prefetchSystemFeatures = async () => {
  await connection()
  const queryClient = getSystemFeaturesQueryClient()
  const queryOptions = systemFeaturesServerQueryOptions()
  const queryState = queryClient.getQueryState(queryOptions.queryKey)

  if (!queryState || queryState.status === 'pending') await queryClient.prefetchQuery(queryOptions)

  return queryClient.getQueryData(queryOptions.queryKey)
}

export const ensureSystemFeatures = async () => {
  await connection()
  return getSystemFeaturesQueryClient().ensureQueryData(systemFeaturesServerQueryOptions())
}
