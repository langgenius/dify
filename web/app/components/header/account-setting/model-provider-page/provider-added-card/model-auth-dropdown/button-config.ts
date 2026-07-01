import type { TFunction } from 'i18next'
import type { CardVariant } from '../use-credential-panel-state'

export function getButtonConfig(variant: CardVariant, hasCredentials: boolean, t: TFunction) {
  if (variant === 'api-required-add') {
    return {
      text: t('modelProvider.auth.addApiKey', { ns: 'common' }),
      variant: 'primary' as const,
    }
  }

  if (variant === 'api-required-configure') {
    return {
      text: t('operation.config', { ns: 'common' }),
      variant: 'primary' as const,
    }
  }

  const text = hasCredentials
    ? t('operation.config', { ns: 'common' })
    : t('modelProvider.auth.addApiKey', { ns: 'common' })

  return { text, variant: 'secondary' as const }
}
