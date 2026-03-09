import type { FC } from 'react'
import type {
  Model,
  ModelItem,
} from '../declarations'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import { cn } from '@/utils/classnames'
import {
  ModelStatusEnum,
} from '../declarations'
import ModelIcon from '../model-icon'
import ModelName from '../model-name'

const STATUS_I18N_KEY: Partial<Record<ModelStatusEnum, string>> = {
  [ModelStatusEnum.quotaExceeded]: 'modelProvider.selector.creditsExhausted',
  [ModelStatusEnum.noConfigure]: 'modelProvider.selector.configureRequired',
  [ModelStatusEnum.noPermission]: 'modelProvider.selector.incompatible',
  [ModelStatusEnum.disabled]: 'modelProvider.selector.disabled',
  [ModelStatusEnum.credentialRemoved]: 'modelProvider.selector.apiKeyUnavailable',
}

type ModelTriggerProps = {
  open: boolean
  provider: Model
  model: ModelItem
  className?: string
  readonly?: boolean
}
const ModelTrigger: FC<ModelTriggerProps> = ({
  open,
  provider,
  model,
  className,
  readonly,
}) => {
  const { t } = useTranslation()
  const isActive = model.status === ModelStatusEnum.active
  const statusI18nKey = STATUS_I18N_KEY[model.status]

  return (
    <div
      className={cn(
        'group flex h-8 items-center gap-0.5 rounded-lg bg-components-input-bg-normal p-1',
        !readonly && 'cursor-pointer hover:bg-components-input-bg-hover',
        open && 'bg-components-input-bg-hover',
        !isActive && 'bg-components-input-bg-disabled hover:bg-components-input-bg-disabled',
        className,
      )}
    >
      <ModelIcon
        className="p-0.5"
        provider={provider}
        modelName={model.model}
      />
      <div className="flex grow items-center gap-1 truncate px-1 py-[3px]">
        <ModelName
          className="grow"
          modelItem={model}
          showMode
          showFeatures
        />
        {!readonly && !isActive && statusI18nKey && (
          <Tooltip>
            <TooltipTrigger
              disabled={model.status !== ModelStatusEnum.noPermission}
              render={(
                <div className="flex shrink-0 items-center gap-[3px] rounded-md border border-text-warning px-[5px] py-0.5">
                  <span className="i-ri-alert-fill h-3 w-3 text-text-warning" />
                  <span className="whitespace-nowrap text-text-warning system-xs-medium">
                    {t(statusI18nKey as 'modelProvider.selector.creditsExhausted', { ns: 'common' })}
                  </span>
                </div>
              )}
            />
            <TooltipContent placement="top" className="z-[1003]">
              {t('modelProvider.selector.incompatibleTip', { ns: 'common' })}
            </TooltipContent>
          </Tooltip>
        )}
        {!readonly && isActive && (
          <span className="i-ri-arrow-down-s-line h-3.5 w-3.5 shrink-0 text-text-tertiary" />
        )}
      </div>
    </div>
  )
}

export default ModelTrigger
