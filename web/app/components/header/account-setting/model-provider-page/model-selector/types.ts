import type {
  I18nObject,
  ProviderModelWithStatusEntity,
} from '@dify/contracts/api/console/workspaces/types.gen'

export type ModelSelectorValue = {
  provider: string
  model: string
  plugin_id?: string
}

export const MODEL_PROVIDER_SETTINGS_ACTION = 'model-provider-settings' as const

export type ModelSelectorOption = ModelSelectorValue | typeof MODEL_PROVIDER_SETTINGS_ACTION

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

export const isModelSelectorAction = (
  option: ModelSelectorOption,
): option is typeof MODEL_PROVIDER_SETTINGS_ACTION => option === MODEL_PROVIDER_SETTINGS_ACTION

export const isSameModelSelectorOption = (
  itemValue: ModelSelectorOption,
  value: ModelSelectorOption,
) => {
  if (isModelSelectorAction(itemValue) || isModelSelectorAction(value)) return itemValue === value

  return itemValue.provider === value.provider && itemValue.model === value.model
}

export const getModelSelectorOptionLabel = (option: ModelSelectorOption) =>
  isModelSelectorAction(option) ? option : option.model
