import type {
  ModelProvider,
} from '../../declarations'

export const useCustomModels = (provider: ModelProvider) => {
  const { custom_models } = provider.custom_configuration

  return custom_models || []
}

export const useCanAddedModels = (provider: ModelProvider) => {
  const { can_added_models } = provider.custom_configuration

  return can_added_models || []
}
