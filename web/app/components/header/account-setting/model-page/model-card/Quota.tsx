import { useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import type { Provider, ProviderWithQuota } from '../declarations'
import Tooltip from '@/app/components/base/tooltip'
import { InfoCircle } from '@/app/components/base/icons/src/vender/line/general'
import { getPayUrl } from '@/service/common'
import Button from '@/app/components/base/button'

type QuotaProps = {
  currentProvider: Provider
}
const Quota: FC<QuotaProps> = ({
  currentProvider,
}) => {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const systemTrial = currentProvider.providers.find(p => p.provider_type === 'system' && (p as ProviderWithQuota)?.quota_type === 'trial') as ProviderWithQuota
  const systemPaid = currentProvider.providers.find(p => p.provider_type === 'system' && (p as ProviderWithQuota)?.quota_type === 'paid') as ProviderWithQuota
  const QUOTA_UNIT_MAP: Record<string, string> = {
    times: t('common.modelProvider.card.callTimes'),
    tokens: 'Tokens',
  }

  const renderStatus = () => {
    const totalQuota = (systemPaid?.is_valid ? systemPaid.quota_limit : 0) + systemTrial.quota_limit
    const totalUsed = (systemPaid?.is_valid ? systemPaid.quota_used : 0) + systemTrial.quota_used

    if (totalQuota === totalUsed) {
      return (
        <div className='px-1.5 bg-[#FEF3F2] rounded-md text-xs font-semibold text-[#D92D20]'>
          {t('common.modelProvider.card.quotaExhausted')}
        </div>
      )
    }
    if (systemPaid?.is_valid) {
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

  const renderQuota = () => {
    if (systemPaid?.is_valid)
      return systemPaid.quota_limit - systemPaid.quota_used

    if (systemTrial.is_valid)
      return systemTrial.quota_limit - systemTrial.quota_used
  }
  const renderUnit = () => {
    if (systemPaid?.is_valid)
      return QUOTA_UNIT_MAP[systemPaid.quota_unit]

    if (systemTrial.is_valid)
      return QUOTA_UNIT_MAP[systemTrial.quota_unit]
  }
  const handleGetPayUrl = async () => {
    setLoading(true)
    try {
      const res = await getPayUrl(`/workspaces/current/model-providers/${systemPaid.provider_name}/checkout-url`)

      window.location.href = res.url
    }
    finally {
      setLoading(false)
    }
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
          <div className='mr-1 text-sm font-medium'>{renderQuota()}</div>
          <div className='mr-1 text-sm'>
            {renderUnit()}
          </div>
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
      {
        systemPaid && (
          <Button
            type='primary'
            className='mt-1.5 !px-3 !h-8 !text-[13px] font-medium !rounded-lg'
            onClick={handleGetPayUrl}
            disabled={loading}
          >
            {t('common.modelProvider.card.buyQuota')}
          </Button>
        )
      }
    </div>
  )
}

export default Quota
