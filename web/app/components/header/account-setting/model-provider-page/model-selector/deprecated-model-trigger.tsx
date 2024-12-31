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
      className={cn('group flex flex-grow items-center p-[3px] pl-1 gap-1 rounded-lg bg-components-input-bg-disabled cursor-pointer', className)}
    >
      <div className='flex items-center py-[1px] gap-1 grow'>
        <ModelIcon
          className="m-0.5"
          provider={currentProvider}
          modelName={modelName}
        />
        <div className='system-sm-regular text-components-input-text-filled truncate'>
          {modelName}
        </div>
      </div>
      <div className='shrink-0 flex items-center justify-center w-4 h-4'>
        <Tooltip popupContent={t('common.modelProvider.deprecated')}>
          <AlertTriangle className='w-4 h-4 text-text-warning-secondary' />
        </Tooltip>
      </div>
    </div>
  )
}

export default ModelTrigger
