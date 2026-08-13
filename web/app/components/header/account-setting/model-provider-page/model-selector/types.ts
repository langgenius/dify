import type {
  I18nObject,
  ProviderModelWithStatusEntity,
} from '@dify/contracts/api/console/workspaces/types.gen'

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

export const isSameModelSelectorValue = (
  itemValue: ModelSelectorValue,
  value: ModelSelectorValue,
) => itemValue.provider === value.provider && itemValue.model === value.model

export const getModelSelectorValueLabel = (value: ModelSelectorValue) => value.model
