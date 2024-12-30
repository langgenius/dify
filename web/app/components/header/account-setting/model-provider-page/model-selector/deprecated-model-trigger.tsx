import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import ModelIcon from '../model-icon'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import { useProviderContext } from '@/context/provider-context'
import Tooltip from '@/app/components/base/tooltip'
import cn from '@/utils/classnames'

type ModelTriggerProps = {
  modelName: string
  providerName: string
  className?: string
}
const ModelTrigger: FC<ModelTriggerProps> = ({
  modelName,
  providerName,
  className,
}) => {
  const { t } = useTranslation()
  const { modelProviders } = useProviderContext()
  const currentProvider = modelProviders.find(provider => provider.provider === providerName)

  return (
    <div
      className={cn('group flex items-center p-1 gap-0.5 rounded-lg bg-components-input-bg-disabled cursor-pointer', className)}
    >
      <ModelIcon
        className='shrink-0 mr-1.5'
        provider={currentProvider}
        modelName={modelName}
      />
      <div className='mr-1 system-sm-regular text-components-input-text-filled truncate'>
        {modelName}
      </div>
      <div className='shrink-0 flex items-center justify-center w-4 h-4'>
        <Tooltip popupContent={t('common.modelProvider.deprecated')}>
          <AlertTriangle className='w-4 h-4 text-[#F79009]' />
        </Tooltip>
      </div>
    </div>
  )
}

export default ModelTrigger
