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
    <div className='group relative min-w-[112px] shrink-0 rounded-lg border-[0.5px] border-components-panel-border bg-white/[0.18] px-3 py-2 shadow-xs'>
      <div className='system-xs-medium-uppercase mb-2 flex h-4 items-center text-text-tertiary'>
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
          <div className='flex h-4 items-center text-xs text-text-tertiary'>
            <span className='system-md-semibold-uppercase mr-0.5 text-text-secondary'>{formatNumber(Math.max((currentQuota?.quota_limit || 0) - (currentQuota?.quota_used || 0), 0))}</span>
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
