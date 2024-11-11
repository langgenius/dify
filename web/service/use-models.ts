import { get } from './base'
import type {
  ModelItem,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  useQuery,
  // useQueryClient,
} from '@tanstack/react-query'

const NAME_SPACE = 'models'

export const useModelProviderModelList = (provider: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'model-list', provider],
    queryFn: () => get<{ data: ModelItem[] }>(`/workspaces/current/model-providers/${provider}/models`),
  })
}
