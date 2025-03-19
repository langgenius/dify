import { useTranslation } from 'react-i18next'
import CustomWebAppBrand from '../custom-web-app-brand'
import { useProviderContext } from '@/context/provider-context'
import { Plan } from '@/app/components/billing/type'
import { contactSalesUrl } from '@/app/components/billing/config'
import { useModalContext } from '@/context/modal-context'

const CustomPage = () => {
  const { t } = useTranslation()
  const { plan, enableBilling } = useProviderContext()
  const { setShowPricingModal } = useModalContext()
  const showBillingTip = enableBilling && plan.type === Plan.sandbox
  const showContact = enableBilling && (plan.type === Plan.professional || plan.type === Plan.team)

  return (
    <div className='flex flex-col'>
      {showBillingTip && (
        <div className='flex justify-between mb-1 p-4 pl-6 bg-gradient-to-r from-components-input-border-active-prompt-1 to-components-input-border-active-prompt-2 shadow-lg backdrop-blur-sm rounded-xl'>
          <div className='space-y-1 text-text-primary-on-surface'>
            <div className='title-xl-semi-bold'>{t('custom.upgradeTip.title')}</div>
            <div className='system-sm-regular'>{t('custom.upgradeTip.des')}</div>
          </div>
          <div className='w-[120px] h-10 flex items-center justify-center bg-white rounded-3xl shadow-xs system-md-semibold text-text-accent cursor-pointer hover:opacity-95' onClick={() => setShowPricingModal()}>{t('billing.upgradeBtn.encourageShort')}</div>
        </div>
      )}
      <CustomWebAppBrand />
      {showContact && (
        <div className='absolute bottom-0 h-[50px] leading-[50px] text-xs text-text-quaternary'>
          {t('custom.customize.prefix')}
          <a className='text-text-accent' href={contactSalesUrl} target='_blank' rel='noopener noreferrer'>{t('custom.customize.contactUs')}</a>
          {t('custom.customize.suffix')}
        </div>
      )}
    </div>
  )
}

export default CustomPage
