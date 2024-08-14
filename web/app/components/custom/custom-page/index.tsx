import { useTranslation } from 'react-i18next'
import CustomWebAppBrand from '../custom-web-app-brand'
import CustomAppHeaderBrand from '../custom-app-header-brand'
import s from '../style.module.css'
import GridMask from '@/app/components/base/grid-mask'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import { useProviderContext } from '@/context/provider-context'
import { Plan } from '@/app/components/billing/type'
import { contactSalesUrl } from '@/app/components/billing/config'

const CustomPage = () => {
  const { t } = useTranslation()
  const { plan, enableBilling } = useProviderContext()

  const showBillingTip = enableBilling && plan.type === Plan.sandbox
  const showCustomAppHeaderBrand = enableBilling && plan.type === Plan.sandbox
  const showContact = enableBilling && (plan.type === Plan.professional || plan.type === Plan.team)

  return (
    <div className='flex flex-col'>
      {
        showBillingTip && (
          <GridMask canvasClassName='!rounded-xl'>
            <div className='flex justify-between mb-1 px-6 py-5 h-[88px] shadow-md rounded-xl border-[0.5px] border-gray-200'>
              <div className={`${s.textGradient} leading-[24px] text-base font-semibold`}>
                <div>{t('custom.upgradeTip.prefix')}</div>
                <div>{t('custom.upgradeTip.suffix')}</div>
              </div>
              <UpgradeBtn />
            </div>
          </GridMask>
        )
      }
      <CustomWebAppBrand />
      {
        showCustomAppHeaderBrand && (
          <>
            <div className='my-2 h-[0.5px] bg-gray-100'></div>
            <CustomAppHeaderBrand />
          </>
        )
      }
      {
        showContact && (
          <div className='absolute bottom-0 h-[50px] leading-[50px] text-xs text-gray-500'>
            {t('custom.customize.prefix')}
            <a className='text-[#155EEF]' href={contactSalesUrl} target='_blank' rel='noopener noreferrer'>{t('custom.customize.contactUs')}</a>
            {t('custom.customize.suffix')}
          </div>
        )
      }
    </div>
  )
}

export default CustomPage
