import type {
  I18nObject,
  ProviderModelWithStatusEntity,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { ConfigurationMethodEnum } from '../declarations'

export type ModelSelectorValue = {
  provider: string
  model: string
  plugin_id?: string
}

export type ModelSelectorModel = Pick<
  ProviderModelWithStatusEntity,
  | 'deprecated'
  | 'has_invalid_load_balancing_configs'
  | 'label'
  | 'load_balancing_enabled'
  | 'model'
  | 'model_properties'
> & {
  features?: readonly string[] | null
  fetch_from: ConfigurationMethodEnum
  model_type: string
  status: string
}

export type ModelSelectorProvider = {
  provider: string
  icon_small?: I18nObject | null
  icon_small_dark?: I18nObject | null
  label: I18nObject
  models: ModelSelectorModel[]
}

export type ModelSelectorModelPredicate = (
  provider: ModelSelectorProvider,
  modelItem: ModelSelectorModel,
) => boolean
