import type { Model, ModelItem, ModelProvider } from './declarations'
import type { CredentialPanelState } from './provider-added-card/use-credential-panel-state'
import { ModelStatusEnum } from './declarations'

export type DerivedModelStatus
  = | 'empty'
    | 'active'
    | 'configure-required'
    | 'credits-exhausted'
    | 'api-key-unavailable'
    | 'disabled'
    | 'incompatible'

export const DERIVED_MODEL_STATUS_BADGE_I18N = {
  'configure-required': 'modelProvider.selector.configureRequired',
  'credits-exhausted': 'modelProvider.selector.creditsExhausted',
  'api-key-unavailable': 'modelProvider.selector.apiKeyUnavailable',
  'disabled': 'modelProvider.selector.disabled',
  'incompatible': 'modelProvider.selector.incompatible',
} as const satisfies Partial<Record<DerivedModelStatus, string>>

export const DERIVED_MODEL_STATUS_TOOLTIP_I18N = {
  'credits-exhausted': 'modelProvider.selector.creditsExhaustedTip',
  'api-key-unavailable': 'modelProvider.selector.apiKeyUnavailableTip',
  'incompatible': 'modelProvider.selector.incompatibleTip',
} as const satisfies Partial<Record<DerivedModelStatus, string>>

export const deriveModelStatus = (
  modelId: string | undefined,
  providerName: string | undefined,
  currentModelProvider: ModelProvider | Model | undefined,
  currentModel: ModelItem | undefined,
  credentialState: CredentialPanelState,
): DerivedModelStatus => {
  if (!modelId || !providerName)
    return 'empty'

  if (!currentModelProvider)
    return 'incompatible'

  const isCreditsExhaustedWithoutApiKey = credentialState.supportsCredits
    && credentialState.isCreditsExhausted
    && !credentialState.hasCredentials
  const isCreditsPriorityExhausted = credentialState.priority === 'credits'
    && credentialState.supportsCredits
    && credentialState.isCreditsExhausted

  if (isCreditsPriorityExhausted || isCreditsExhaustedWithoutApiKey)
    return 'credits-exhausted'

  if (!currentModel)
    return 'incompatible'

  if (credentialState.variant === 'api-unavailable')
    return 'api-key-unavailable'

  switch (currentModel.status) {
    case ModelStatusEnum.active:
      return 'active'
    case ModelStatusEnum.noConfigure:
      return 'configure-required'
    case ModelStatusEnum.quotaExceeded:
      return 'credits-exhausted'
    case ModelStatusEnum.credentialRemoved:
      return 'api-key-unavailable'
    case ModelStatusEnum.disabled:
      return 'disabled'
    case ModelStatusEnum.noPermission:
    default:
      return 'incompatible'
  }
}
