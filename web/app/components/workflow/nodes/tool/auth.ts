import type { ToolWithProvider } from '../../types'
import type { ToolNodeType } from './types'
import { CollectionType } from '@/app/components/tools/types'

type ToolAuthorizationCollection = Pick<ToolWithProvider, 'allow_delete' | 'is_team_authorization'>

export const isToolAuthorizationRequired = (
  providerType: ToolNodeType['provider_type'],
  collection?: ToolAuthorizationCollection,
) => {
  return providerType === CollectionType.builtIn
    && !!collection?.allow_delete
    && collection?.is_team_authorization === false
}
