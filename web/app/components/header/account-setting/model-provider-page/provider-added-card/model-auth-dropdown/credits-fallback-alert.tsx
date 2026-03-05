import { useTranslation } from 'react-i18next'

type CreditsFallbackAlertProps = {
  hasCredentials: boolean
}

export default function CreditsFallbackAlert({ hasCredentials }: CreditsFallbackAlertProps) {
  const { t } = useTranslation()

  const titleKey = hasCredentials
    ? 'modelProvider.card.apiKeyUnavailableFallback'
    : 'modelProvider.card.noApiKeysFallback'

  return (
    <div className="mx-3 mb-1 mt-0.5 rounded-lg bg-background-section-burn p-3">
      <div className="text-text-primary system-xs-medium">
        {t(titleKey, { ns: 'common' })}
      </div>
      {hasCredentials && (
        <div className="mt-0.5 text-text-tertiary system-2xs-regular">
          {t('modelProvider.card.apiKeyUnavailableFallbackDescription', { ns: 'common' })}
        </div>
      )}
    </div>
  )
}
