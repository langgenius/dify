import { ModelStatusEnum } from './declarations'

export const MODEL_STATUS_I18N_KEY: Partial<Record<ModelStatusEnum, string>> = {
  [ModelStatusEnum.quotaExceeded]: 'modelProvider.selector.creditsExhausted',
  [ModelStatusEnum.noConfigure]: 'modelProvider.selector.configureRequired',
  [ModelStatusEnum.noPermission]: 'modelProvider.selector.incompatible',
  [ModelStatusEnum.disabled]: 'modelProvider.selector.disabled',
  [ModelStatusEnum.credentialRemoved]: 'modelProvider.selector.apiKeyUnavailable',
}
