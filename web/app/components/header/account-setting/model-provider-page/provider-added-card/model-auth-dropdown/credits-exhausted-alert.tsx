import { useTranslation } from 'react-i18next'
import { formatNumber } from '@/utils/format'
import { useTrialCredits } from '../use-trial-credits'

type CreditsExhaustedAlertProps = {
  hasApiKeyFallback: boolean
}

export default function CreditsExhaustedAlert({ hasApiKeyFallback }: CreditsExhaustedAlertProps) {
  const { t } = useTranslation()
  const { credits } = useTrialCredits()
  const totalCredits = 10_000

  const titleKey = hasApiKeyFallback
    ? 'modelProvider.card.creditsExhaustedFallback'
    : 'modelProvider.card.creditsExhaustedMessage'
  const descriptionKey = hasApiKeyFallback
    ? 'modelProvider.card.creditsExhaustedFallbackDescription'
    : 'modelProvider.card.creditsExhaustedDescription'

  return (
    <div className="mx-3 mb-1 mt-0.5 rounded-lg bg-background-section-burn p-3">
      <div className="text-text-primary system-xs-medium">
        {t(titleKey, { ns: 'common' })}
      </div>
      <div className="mt-0.5 text-text-tertiary system-2xs-regular">
        {t(descriptionKey, {
          ns: 'common',
          upgradeLink: `<a class="text-text-accent cursor-pointer system-2xs-medium-uppercase">${t('modelProvider.card.upgradePlan', { ns: 'common' })}</a>`,
          interpolation: { escapeValue: false },
        })}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-text-tertiary system-2xs-regular">
          {t('modelProvider.card.usageLabel', { ns: 'common' })}
        </span>
        <div className="flex items-center gap-0.5 text-text-tertiary system-2xs-regular">
          <span className="i-ri-coin-line h-3 w-3" />
          <span>
            {formatNumber(totalCredits - credits)}
            /
            {formatNumber(totalCredits)}
          </span>
        </div>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-state-destructive-hover-alt">
        <div className="h-full rounded-full bg-state-destructive-solid" style={{ width: '100%' }} />
      </div>
    </div>
  )
}
