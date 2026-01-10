import type { ModelItem, ModelProvider } from '../declarations'
import { useDebounceFn } from 'ahooks'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { Balance } from '@/app/components/base/icons/src/vender/line/financeAndECommerce'
import Switch from '@/app/components/base/switch'
import Tooltip from '@/app/components/base/tooltip'
import { Plan } from '@/app/components/billing/type'
import { useAppContext } from '@/context/app-context'
import { useProviderContext, useProviderContextSelector } from '@/context/provider-context'
import { disableModel, enableModel } from '@/service/common'
import { cn } from '@/utils/classnames'
import { ModelStatusEnum } from '../declarations'
import { useUpdateModelList } from '../hooks'
import { ConfigModel } from '../model-auth'
import ModelIcon from '../model-icon'
import ModelName from '../model-name'

export type ModelListItemProps = {
  model: ModelItem
  provider: ModelProvider
  isConfigurable: boolean
  onChange?: (provider: string) => void
  onModifyLoadBalancing?: (model: ModelItem) => void
}

const ModelListItem = ({ model, provider, isConfigurable, onChange, onModifyLoadBalancing }: ModelListItemProps) => {
  const { t } = useTranslation()
  const { plan } = useProviderContext()
  const modelLoadBalancingEnabled = useProviderContextSelector(state => state.modelLoadBalancingEnabled)
  const { isCurrentWorkspaceManager } = useAppContext()
  const updateModelList = useUpdateModelList()

  const toggleModelEnablingStatus = useCallback(async (enabled: boolean) => {
    if (enabled)
      await enableModel(`/workspaces/current/model-providers/${provider.provider}/models/enable`, { model: model.model, model_type: model.model_type })
    else
      await disableModel(`/workspaces/current/model-providers/${provider.provider}/models/disable`, { model: model.model, model_type: model.model_type })
    updateModelList(model.model_type)
    onChange?.(provider.provider)
  }, [model.model, model.model_type, onChange, provider.provider, updateModelList])

  const { run: debouncedToggleModelEnablingStatus } = useDebounceFn(toggleModelEnablingStatus, { wait: 500 })

  const onEnablingStateChange = useCallback(async (value: boolean) => {
    debouncedToggleModelEnablingStatus(value)
  }, [debouncedToggleModelEnablingStatus])

  return (
    <div
      key={`${model.model}-${model.fetch_from}`}
      className={cn('group flex h-8 items-center rounded-lg pl-2 pr-2.5', isConfigurable && 'hover:bg-components-panel-on-panel-item-bg-hover', model.deprecated && 'opacity-60')}
    >
      <ModelIcon
        className="mr-2 shrink-0"
        provider={provider}
        modelName={model.model}
      />
      <ModelName
        className="system-md-regular grow text-text-secondary"
        modelItem={model}
        showModelType
        showMode
        showContextSize
        showFeatures
        showFeaturesLabel
      >
      </ModelName>
      <div className="flex shrink-0 items-center">
        {modelLoadBalancingEnabled && !model.deprecated && model.load_balancing_enabled && !model.has_invalid_load_balancing_configs && (
          <Badge className="mr-1 h-[18px] w-[18px] items-center justify-center border-text-accent-secondary p-0">
            <Balance className="h-3 w-3 text-text-accent-secondary" />
          </Badge>
        )}
        {
          (isCurrentWorkspaceManager && (modelLoadBalancingEnabled || plan.type === Plan.sandbox) && !model.deprecated && [ModelStatusEnum.active, ModelStatusEnum.disabled].includes(model.status)) && (
            <ConfigModel
              onClick={() => onModifyLoadBalancing?.(model)}
              loadBalancingEnabled={model.load_balancing_enabled}
              loadBalancingInvalid={model.has_invalid_load_balancing_configs}
              credentialRemoved={model.status === ModelStatusEnum.credentialRemoved}
            />
          )
        }
        {
          model.deprecated
            ? (
                <Tooltip
                  popupContent={
                    <span className="font-semibold">{t('modelProvider.modelHasBeenDeprecated', { ns: 'common' })}</span>
                  }
                  offset={{ mainAxis: 4 }}
                >
                  <Switch defaultValue={false} disabled size="md" />
                </Tooltip>
              )
            : (isCurrentWorkspaceManager && (
                <Switch
                  className="ml-2"
                  defaultValue={model?.status === ModelStatusEnum.active}
                  disabled={![ModelStatusEnum.active, ModelStatusEnum.disabled].includes(model.status)}
                  size="md"
                  onChange={onEnablingStateChange}
                />
              ))
        }
      </div>
    </div>
  )
}

export default memo(ModelListItem)
