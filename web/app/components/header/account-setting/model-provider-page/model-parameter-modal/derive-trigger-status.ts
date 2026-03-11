import type { ModelItem, ModelProvider } from '../declarations'
import type { CredentialPanelState } from '../provider-added-card/use-credential-panel-state'
import { ModelStatusEnum } from '../declarations'

export type TriggerStatus
  = | 'empty'
    | 'active'
    | 'credits-exhausted'
    | 'api-key-unavailable'
    | 'incompatible'

export function deriveTriggerStatus(
  modelId: string | undefined,
  providerName: string | undefined,
  currentModelProvider: ModelProvider | undefined,
  currentModel: ModelItem | undefined,
  credentialState: CredentialPanelState,
): TriggerStatus {
  if (!modelId || !providerName)
    return 'empty'

  if (!currentModelProvider)
    return 'incompatible'

  if (credentialState.priority === 'credits'
    && credentialState.supportsCredits
    && credentialState.isCreditsExhausted) {
    return 'credits-exhausted'
  }

  if (credentialState.variant === 'api-unavailable')
    return 'api-key-unavailable'

  if (!currentModel)
    return 'incompatible'

  if (currentModel.status !== ModelStatusEnum.active)
    return 'incompatible'

  return 'active'
}

export const TRIGGER_STATUS_BADGE_I18N: Partial<Record<TriggerStatus, string>> = {
  'credits-exhausted': 'modelProvider.selector.creditsExhausted',
  'api-key-unavailable': 'modelProvider.selector.apiKeyUnavailable',
  'incompatible': 'modelProvider.selector.incompatible',
}

export const TRIGGER_STATUS_TOOLTIP_I18N: Partial<Record<TriggerStatus, string>> = {
  'credits-exhausted': 'modelProvider.selector.creditsExhaustedTip',
  'api-key-unavailable': 'modelProvider.selector.apiKeyUnavailableTip',
  'incompatible': 'modelProvider.selector.incompatibleTip',
}
