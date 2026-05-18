export type ModelSelectorValue = {
  provider: string
  model: string
}

export const isSameModelSelectorValue = (
  itemValue: ModelSelectorValue,
  value: ModelSelectorValue,
) => itemValue.provider === value.provider && itemValue.model === value.model

export const getModelSelectorValueLabel = (itemValue: ModelSelectorValue) => itemValue.model
