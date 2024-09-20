import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelProvider } from '../declarations'
import {
  CustomConfigurationStatusEnum,
  PreferredProviderTypeEnum,
  QuotaUnitEnum,
} from '../declarations'
import {
  MODEL_PROVIDER_QUOTA_GET_PAID,
} from '../utils'
import PriorityUseTip from './priority-use-tip'
import Tooltip from '@/app/components/base/tooltip'
import { formatNumber } from '@/utils/format'

type QuotaPanelProps = {
  provider: ModelProvider
}
const QuotaPanel: FC<QuotaPanelProps> = ({
  provider,
}) => {
  const { t } = useTranslation()

  const customConfig = provider.custom_configuration
  const priorityUseType = provider.preferred_provider_type
  const systemConfig = provider.system_configuration
  const currentQuota = systemConfig.enabled && systemConfig.quota_configurations.find(item => item.quota_type === systemConfig.current_quota_type)
  const openaiOrAnthropic = MODEL_PROVIDER_QUOTA_GET_PAID.includes(provider.provider)

  return (
    <div className='group relative shrink-0 min-w-[112px] px-3 py-2 rounded-lg bg-white/[0.3] border-[0.5px] border-black/5'>
      <div className='flex items-center mb-2 h-4 text-xs font-medium text-gray-500'>
        {t('common.modelProvider.quota')}
        <Tooltip popupContent={
          openaiOrAnthropic
            ? t('common.modelProvider.card.tip')
            : t('common.modelProvider.quotaTip')
        }
        />
      </div>
      {
        currentQuota && (
          <div className='flex items-center h-4 text-xs text-gray-500'>
            <span className='mr-0.5 text-sm font-semibold text-gray-700'>{formatNumber((currentQuota?.quota_limit || 0) - (currentQuota?.quota_used || 0))}</span>
            {
              currentQuota?.quota_unit === QuotaUnitEnum.tokens && 'Tokens'
            }
            {
              currentQuota?.quota_unit === QuotaUnitEnum.times && t('common.modelProvider.callTimes')
            }
            {
              currentQuota?.quota_unit === QuotaUnitEnum.credits && t('common.modelProvider.credits')
            }
          </div>
        )
      }
      {
        priorityUseType === PreferredProviderTypeEnum.system && customConfig.status === CustomConfigurationStatusEnum.active && (
          <PriorityUseTip />
        )
      }
    </div>
  )
}

export default QuotaPanel
