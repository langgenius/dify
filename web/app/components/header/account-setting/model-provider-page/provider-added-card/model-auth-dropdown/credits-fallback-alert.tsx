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
    <div className="mx-2 mt-0.5 mb-1 rounded-lg bg-background-section-burn p-3">
      <div className="flex flex-col gap-1">
        <div className="system-sm-medium text-text-primary">
          {t(titleKey, { ns: 'common' })}
        </div>
        {hasCredentials && (
          <div className="system-xs-regular text-text-tertiary">
            {t('modelProvider.card.apiKeyUnavailableFallbackDescription', { ns: 'common' })}
          </div>
        )}
      </div>
    </div>
  )
}
