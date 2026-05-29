import { queryOptions } from '@tanstack/react-query'
import { IS_CLOUD_EDITION } from '@/config'
import { consoleClient, consoleQuery } from './client'

type TrialModelsResponse = {
  trial_models: string[]
}

const emptyTrialModelsResponse: TrialModelsResponse = {
  trial_models: [],
}

export const trialModelsQueryOptions = () =>
  queryOptions<TrialModelsResponse, Error, string[]>({
    queryKey: consoleQuery.trialModels.queryKey(),
    queryFn: async () => {
      if (!IS_CLOUD_EDITION)
        return emptyTrialModelsResponse

      try {
        return await consoleClient.trialModels()
      }
      catch (err) {
        console.error('[trialModels] fetch failed, using empty list', err)
        return emptyTrialModelsResponse
      }
    },
    select: data => data.trial_models,
  })
