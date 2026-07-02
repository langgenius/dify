import type { Model, ModelItem } from '../declarations'

export type ModelSelectorValue = {
  provider: string
  model: string
}

export type ModelSelectorModelPredicate = (provider: Model, modelItem: ModelItem) => boolean

export const isSameModelSelectorValue = (
  itemValue: ModelSelectorValue,
  value: ModelSelectorValue,
) => itemValue.provider === value.provider && itemValue.model === value.model

export const getModelSelectorValueLabel = (itemValue: ModelSelectorValue) => itemValue.model
