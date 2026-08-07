import type { I18nObject } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ModelItem } from '../declarations'

export type ModelSelectorValue = {
  provider: string
  model: string
}

export type ModelSelectorProvider = {
  provider: string
  icon_small?: I18nObject | null
  icon_small_dark?: I18nObject | null
  label: I18nObject
  models: ModelItem[]
}

export type ModelSelectorModelPredicate = (
  provider: ModelSelectorProvider,
  modelItem: ModelItem,
) => boolean

export const isSameModelSelectorValue = (
  itemValue: ModelSelectorValue,
  value: ModelSelectorValue,
) => itemValue.provider === value.provider && itemValue.model === value.model

export const getModelSelectorValueLabel = (itemValue: ModelSelectorValue) => itemValue.model
