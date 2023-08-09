import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import type { SystemProvider } from '../declarations'
import Button from '@/app/components/base/button'
import Tooltip from '@/app/components/base/tooltip'
import { InfoCircle } from '@/app/components/base/icons/src/vender/line/general'

type QuotaProps = {
  currentProvider: SystemProvider
}
const Quota: FC<QuotaProps> = ({
  currentProvider,
}) => {
  const { t } = useTranslation()
  const systemTrial = currentProvider.providers[0]
  const systemPaid = currentProvider.providers[1]

  const renderStatus = () => {
    const totalQuota = (systemPaid.is_valid ? systemPaid.quota_limit : 0) + systemTrial.quota_limit
    const totalUsed = (systemPaid.is_valid ? systemPaid.quota_used : 0) + systemTrial.quota_used

    if (totalQuota === totalUsed) {
      return (
        <div className='px-1.5 bg-[#FEF3F2] rounded-md text-xs font-semibold text-[#D92D20]'>
          {t('common.modelProvider.card.quotaExhausted')}
        </div>
      )
    }
    if (systemPaid.is_valid) {
      return (
        <div className='px-1.5 bg-[#FFF6ED] rounded-md text-xs font-semibold text-[#EC4A0A]'>
          {t('common.modelProvider.card.paid')}
        </div>
      )
    }
    return (
      <div className='px-1.5 bg-primary-50 rounded-md text-xs font-semibold text-primary-600'>
        {t('common.modelProvider.card.onTrial')}
      </div>
    )
  }

  return (
    <div className='flex justify-between px-4 py-3 border-b-[0.5px] border-b-[rgba(0, 0, 0, 0.5)]'>
      <div>
        <div className='flex items-center mb-1 h-5'>
          <div className='mr-1 text-xs font-medium text-gray-500'>
            {t('common.modelProvider.card.quota')}
          </div>
          {renderStatus()}
        </div>
        <div className='flex items-center text-gray-700'>
          <div className='mr-1 text-sm font-medium'>200</div>
          <div className='mr-1 text-sm'>{t('common.modelProvider.card.callTimes')}</div>
          <Tooltip
            selector='setting-model-card'
            htmlContent={
              <div className='w-[261px] text-gray-500'>{t('common.modelProvider.card.tip')}</div>
            }
          >
            <InfoCircle className='w-3 h-3 text-gray-400 hover:text-gray-700' />
          </Tooltip>
        </div>
      </div>
      <Button className='mt-1.5 !px-3 !h-8 !text-[13px] font-medium rounded-lg' type='primary'>{t('common.modelProvider.card.buyQuota')}</Button>
    </div>
  )
}

export default Quota
