import { useTranslation } from 'react-i18next'
import { contactSalesUrl } from '@/app/components/billing/config'
import { Plan } from '@/app/components/billing/type'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import CustomWebAppBrand from '../custom-web-app-brand'

const CustomPage = () => {
  const { t } = useTranslation()
  const { plan, enableBilling } = useProviderContext()
  const { setShowPricingModal } = useModalContext()
  const showBillingTip = enableBilling && plan.type === Plan.sandbox
  const showContact = enableBilling && (plan.type === Plan.professional || plan.type === Plan.team)

  return (
    <div className="flex flex-col">
      {showBillingTip && (
        <div className="mb-1 flex justify-between rounded-xl bg-gradient-to-r from-components-input-border-active-prompt-1 to-components-input-border-active-prompt-2 p-4 pl-6 shadow-lg backdrop-blur-sm">
          <div className="space-y-1 text-text-primary-on-surface">
            <div className="title-xl-semi-bold">{t('upgradeTip.title', { ns: 'custom' })}</div>
            <div className="system-sm-regular">{t('upgradeTip.des', { ns: 'custom' })}</div>
          </div>
          <div className="system-md-semibold flex h-10 w-[120px] cursor-pointer items-center justify-center rounded-3xl bg-white text-text-accent shadow-xs hover:opacity-95" onClick={() => setShowPricingModal()}>{t('upgradeBtn.encourageShort', { ns: 'billing' })}</div>
        </div>
      )}
      <CustomWebAppBrand />
      {showContact && (
        <div className="absolute bottom-0 h-[50px] text-xs leading-[50px] text-text-quaternary">
          {t('customize.prefix', { ns: 'custom' })}
          <a className="text-text-accent" href={contactSalesUrl} target="_blank" rel="noopener noreferrer">{t('customize.contactUs', { ns: 'custom' })}</a>
          {t('customize.suffix', { ns: 'custom' })}
        </div>
      )}
    </div>
  )
}

export default CustomPage
