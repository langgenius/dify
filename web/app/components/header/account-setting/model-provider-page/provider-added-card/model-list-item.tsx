import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useDebounceFn } from 'ahooks'
import type { CustomConfigurationModelFixedFields, ModelItem, ModelProvider } from '../declarations'
import { ConfigurationMethodEnum, ModelStatusEnum } from '../declarations'
import ModelBadge from '../model-badge'
import ModelIcon from '../model-icon'
import ModelName from '../model-name'
import classNames from '@/utils/classnames'
import Button from '@/app/components/base/button'
import { Balance } from '@/app/components/base/icons/src/vender/line/financeAndECommerce'
import { Settings01 } from '@/app/components/base/icons/src/vender/line/general'
import Switch from '@/app/components/base/switch'
import Tooltip from '@/app/components/base/tooltip'
import { useProviderContext, useProviderContextSelector } from '@/context/provider-context'
import { disableModel, enableModel } from '@/service/common'
import { Plan } from '@/app/components/billing/type'
import { useAppContext } from '@/context/app-context'

export type ModelListItemProps = {
  model: ModelItem
  provider: ModelProvider
  isConfigurable: boolean
  onConfig: (currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields) => void
  onModifyLoadBalancing?: (model: ModelItem) => void
}

const ModelListItem = ({ model, provider, isConfigurable, onConfig, onModifyLoadBalancing }: ModelListItemProps) => {
  const { t } = useTranslation()
  const { plan } = useProviderContext()
  const modelLoadBalancingEnabled = useProviderContextSelector(state => state.modelLoadBalancingEnabled)
  const { isCurrentWorkspaceManager } = useAppContext()

  const toggleModelEnablingStatus = useCallback(async (enabled: boolean) => {
    if (enabled)
      await enableModel(`/workspaces/current/model-providers/${provider.provider}/models/enable`, { model: model.model, model_type: model.model_type })
    else
      await disableModel(`/workspaces/current/model-providers/${provider.provider}/models/disable`, { model: model.model, model_type: model.model_type })
  }, [model.model, model.model_type, provider.provider])

  const { run: debouncedToggleModelEnablingStatus } = useDebounceFn(toggleModelEnablingStatus, { wait: 500 })

  const onEnablingStateChange = useCallback(async (value: boolean) => {
    debouncedToggleModelEnablingStatus(value)
  }, [debouncedToggleModelEnablingStatus])

  return (
    <div
      key={model.model}
      className={classNames(
        'group flex items-center pl-2 pr-2.5 h-8 rounded-lg',
        isConfigurable && 'hover:bg-components-panel-on-panel-item-bg-hover',
        model.deprecated && 'opacity-60',
      )}
    >
      <ModelIcon
        className='shrink-0 mr-2'
        provider={provider}
        modelName={model.model}
      />
      <ModelName
        className='grow system-md-regular text-text-secondary'
        modelItem={model}
        showModelType
        showMode
        showContextSize
      >
        {modelLoadBalancingEnabled && !model.deprecated && model.load_balancing_enabled && (
          <ModelBadge className='ml-1 uppercase text-text-accent-secondary border-text-accent-secondary'>
            <Balance className='w-3 h-3 mr-0.5' />
            {t('common.modelProvider.loadBalancingHeadline')}
          </ModelBadge>
        )}
      </ModelName>
      <div className='shrink-0 flex items-center'>
        {
          model.fetch_from === ConfigurationMethodEnum.customizableModel
            ? (isCurrentWorkspaceManager && (
              <Button
                size='small'
                className='hidden group-hover:flex'
                onClick={() => onConfig({ __model_name: model.model, __model_type: model.model_type })}
              >
                <Settings01 className='mr-1 w-3.5 h-3.5' />
                {t('common.modelProvider.config')}
              </Button>
            ))
            : (isCurrentWorkspaceManager && (modelLoadBalancingEnabled || plan.type === Plan.sandbox) && !model.deprecated && [ModelStatusEnum.active, ModelStatusEnum.disabled].includes(model.status))
              ? (
                <Button
                  size='small'
                  className='opacity-0 group-hover:opacity-100 transition-opacity'
                  onClick={() => onModifyLoadBalancing?.(model)}
                >
                  <Balance className='mr-1 w-3.5 h-3.5' />
                  {t('common.modelProvider.configLoadBalancing')}
                </Button>
              )
              : null
        }
        {
          model.deprecated
            ? (
              <Tooltip
                popupContent={
                  <span className='font-semibold'>{t('common.modelProvider.modelHasBeenDeprecated')}</span>} offset={{ mainAxis: 4 }
                }
                needsDelay
              >
                <Switch defaultValue={false} disabled size='md' />
              </Tooltip>
            )
            : (isCurrentWorkspaceManager && (
              <Switch
                className='ml-2'
                defaultValue={model?.status === ModelStatusEnum.active}
                disabled={![ModelStatusEnum.active, ModelStatusEnum.disabled].includes(model.status)}
                size='md'
                onChange={onEnablingStateChange}
              />
            ))
        }
      </div>
    </div>
  )
}

export default memo(ModelListItem)
