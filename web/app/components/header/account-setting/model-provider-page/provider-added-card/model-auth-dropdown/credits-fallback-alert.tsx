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
    <div className="mx-2 mb-1 mt-0.5 rounded-lg bg-background-section-burn p-3">
      <div className="flex flex-col gap-1">
        <div className="text-text-primary system-sm-medium">
          {t(titleKey, { ns: 'common' })}
        </div>
        {hasCredentials && (
          <div className="text-text-tertiary system-xs-regular">
            {t('modelProvider.card.apiKeyUnavailableFallbackDescription', { ns: 'common' })}
          </div>
        )}
      </div>
    </div>
  )
}
