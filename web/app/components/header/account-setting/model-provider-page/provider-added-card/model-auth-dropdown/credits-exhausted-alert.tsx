import { Trans, useTranslation } from 'react-i18next'
import { CreditsCoin } from '@/app/components/base/icons/src/vender/line/financeAndECommerce'
import { useModalContextSelector } from '@/context/modal-context'
import { formatNumber } from '@/utils/format'
import { useTrialCredits } from '../use-trial-credits'

type CreditsExhaustedAlertProps = {
  hasApiKeyFallback: boolean
}

export default function CreditsExhaustedAlert({ hasApiKeyFallback }: CreditsExhaustedAlertProps) {
  const { t } = useTranslation()
  const setShowPricingModal = useModalContextSelector(s => s.setShowPricingModal)
  const { credits, totalCredits } = useTrialCredits()

  const titleKey = hasApiKeyFallback
    ? 'modelProvider.card.creditsExhaustedFallback'
    : 'modelProvider.card.creditsExhaustedMessage'
  const descriptionKey = hasApiKeyFallback
    ? 'modelProvider.card.creditsExhaustedFallbackDescription'
    : 'modelProvider.card.creditsExhaustedDescription'

  const usedCredits = totalCredits - credits
  const usagePercent = totalCredits > 0 ? Math.min((usedCredits / totalCredits) * 100, 100) : 100

  return (
    <div className="mx-2 mb-1 mt-0.5 rounded-lg bg-background-section-burn p-3">
      <div className="flex flex-col gap-1">
        <div className="text-text-primary system-sm-medium">
          {t(titleKey, { ns: 'common' })}
        </div>
        <div className="text-text-tertiary system-xs-regular">
          <Trans
            i18nKey={descriptionKey}
            ns="common"
            components={{
              upgradeLink: (
                <button
                  type="button"
                  className="cursor-pointer border-0 bg-transparent p-0 text-left text-text-accent system-xs-medium"
                  onClick={() => setShowPricingModal()}
                />
              ),
            }}
          />
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-text-tertiary system-xs-medium">
            {t('modelProvider.card.usageLabel', { ns: 'common' })}
          </span>
          <div className="flex items-center gap-0.5 text-text-tertiary system-xs-regular">
            <CreditsCoin className="h-3 w-3" />
            <span>
              {formatNumber(usedCredits)}
              /
              {formatNumber(totalCredits)}
            </span>
          </div>
        </div>
        <div className="h-1 overflow-hidden rounded-[6px] bg-components-progress-error-bg">
          <div
            className="h-full rounded-l-[6px] bg-components-progress-error-progress"
            style={{ width: `${usagePercent}%` }}
          />
        </div>
      </div>
    </div>
  )
}
