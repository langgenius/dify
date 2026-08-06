import { cache } from 'react'
import { getQueryClient } from '@/app/get-query-client'
import { serverConsoleQuery } from '@/service/server'
import 'server-only'

export const getSystemFeaturesQueryClient = cache(getQueryClient)

export const systemFeaturesServerQueryOptions = () =>
  serverConsoleQuery.systemFeatures.get.queryOptions()
