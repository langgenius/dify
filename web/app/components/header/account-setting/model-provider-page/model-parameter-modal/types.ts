import type {
  Model,
  ModelItem,
  ModelProvider,
} from '../declarations'

export type TriggerProps = {
  open?: boolean
  currentProvider?: ModelProvider | Model
  currentModel?: ModelItem
  providerName?: string
  modelId?: string
}
