import { MeterIndicator, MeterRoot, MeterTrack } from '@langgenius/dify-ui/meter'
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
  const hasTotal = totalCredits > 0
  const meterValue = hasTotal ? Math.min(usedCredits, totalCredits) : 1
  const meterMax = hasTotal ? totalCredits : 1
  const usageLabel = t('modelProvider.card.usageLabel', { ns: 'common' })

  return (
    <div className="mx-2 mt-0.5 mb-1 rounded-lg bg-background-section-burn p-3">
      <div className="flex flex-col gap-1">
        <div className="system-sm-medium text-text-primary">
          {t(titleKey, { ns: 'common' })}
        </div>
        <div className="system-xs-regular text-text-tertiary">
          <Trans
            i18nKey={descriptionKey}
            ns="common"
            components={{
              upgradeLink: (
                <button
                  type="button"
                  className="cursor-pointer border-0 bg-transparent p-0 text-left system-xs-medium text-text-accent"
                  onClick={() => setShowPricingModal()}
                />
              ),
            }}
          />
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="system-xs-medium text-text-tertiary">
            {usageLabel}
          </span>
          <div className="flex items-center gap-0.5 system-xs-regular text-text-tertiary">
            <CreditsCoin className="h-3 w-3" />
            <span>
              {formatNumber(usedCredits)}
              /
              {formatNumber(totalCredits)}
            </span>
          </div>
        </div>
        <MeterRoot value={meterValue} max={meterMax} aria-label={usageLabel}>
          <MeterTrack className="bg-components-progress-error-bg">
            <MeterIndicator tone="error" />
          </MeterTrack>
        </MeterRoot>
      </div>
    </div>
  )
}
