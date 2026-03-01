import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'

export const supportFunctionCall = (features: ModelFeatureEnum[] = []): boolean => {
  if (!features || !features.length)
    return false
  return features.some(feature => [ModelFeatureEnum.toolCall, ModelFeatureEnum.multiToolCall, ModelFeatureEnum.streamToolCall].includes(feature))
}
