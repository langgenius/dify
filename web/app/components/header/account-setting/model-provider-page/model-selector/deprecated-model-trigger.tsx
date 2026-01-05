import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import Tooltip from '@/app/components/base/tooltip'
import { useProviderContext } from '@/context/provider-context'
import { cn } from '@/utils/classnames'
import ModelIcon from '../model-icon'

type ModelTriggerProps = {
  modelName: string
  providerName: string
  className?: string
  showWarnIcon?: boolean
  contentClassName?: string
}
const ModelTrigger: FC<ModelTriggerProps> = ({
  modelName,
  providerName,
  className,
  showWarnIcon,
  contentClassName,
}) => {
  const { t } = useTranslation()
  const { modelProviders } = useProviderContext()
  const currentProvider = modelProviders.find(provider => provider.provider === providerName)

  return (
    <div
      className={cn('group box-content flex h-8 grow cursor-pointer items-center gap-1 rounded-lg bg-components-input-bg-disabled p-[3px] pl-1', className)}
    >
      <div className={cn('flex w-full items-center', contentClassName)}>
        <div className="flex min-w-0 flex-1 items-center gap-1 py-[1px]">
          <ModelIcon
            className="h-4 w-4"
            provider={currentProvider}
            modelName={modelName}
          />
          <div className="system-sm-regular truncate text-components-input-text-filled">
            {modelName}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-center">
          {showWarnIcon && (
            <Tooltip popupContent={t('modelProvider.deprecated', { ns: 'common' })}>
              <AlertTriangle className="h-4 w-4 text-text-warning-secondary" />
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
}

export default ModelTrigger
