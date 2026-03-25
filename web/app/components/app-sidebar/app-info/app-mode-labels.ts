import type { TFunction } from 'i18next'
import { AppModeEnum } from '@/types/app'

export function getAppModeLabel(mode: string, t: TFunction): string {
  switch (mode) {
    case AppModeEnum.ADVANCED_CHAT:
      return t('types.advanced', { ns: 'app' })
    case AppModeEnum.AGENT_CHAT:
      return t('types.agent', { ns: 'app' })
    case AppModeEnum.CHAT:
      return t('types.chatbot', { ns: 'app' })
    case AppModeEnum.COMPLETION:
      return t('types.completion', { ns: 'app' })
    default:
      return t('types.workflow', { ns: 'app' })
  }
}
