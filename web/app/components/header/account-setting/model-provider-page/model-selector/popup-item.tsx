import type { FC } from 'react'
import type {
  DefaultModel,
  Model,
  ModelItem,
} from '../declarations'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CreditsCoin } from '@/app/components/base/icons/src/vender/line/financeAndECommerce'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/app/components/base/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { cn } from '@/utils/classnames'
import {
  ConfigurationMethodEnum,
  ModelFeatureEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '../declarations'
import {
  useLanguage,
  useUpdateModelList,
  useUpdateModelProviders,
} from '../hooks'
import ModelBadge from '../model-badge'
import ModelIcon from '../model-icon'
import ModelName from '../model-name'
import DropdownContent from '../provider-added-card/model-auth-dropdown/dropdown-content'
import { useChangeProviderPriority } from '../provider-added-card/use-change-provider-priority'
import { useCredentialPanelState } from '../provider-added-card/use-credential-panel-state'
import {
  modelTypeFormat,
  sizeFormat,
} from '../utils'
import FeatureIcon from './feature-icon'

type PopupItemProps = {
  defaultModel?: DefaultModel
  model: Model
  onSelect: (provider: string, model: ModelItem) => void
  onHide: () => void
}
const PopupItem: FC<PopupItemProps> = ({
  defaultModel,
  model,
  onSelect,
  onHide,
}) => {
  const [collapsed, setCollapsed] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const { t } = useTranslation()
  const language = useLanguage()
  const { setShowModelModal } = useModalContext()
  const { modelProviders } = useProviderContext()
  const updateModelList = useUpdateModelList()
  const updateModelProviders = useUpdateModelProviders()
  const currentProvider = modelProviders.find(provider => provider.provider === model.provider)
  const handleSelect = (provider: string, modelItem: ModelItem) => {
    if (modelItem.status !== ModelStatusEnum.active)
      return

    onSelect(provider, modelItem)
  }
  const handleOpenModelModal = () => {
    if (!currentProvider)
      return
    setShowModelModal({
      payload: {
        currentProvider,
        currentConfigurationMethod: ConfigurationMethodEnum.predefinedModel,
      },
      onSaveCallback: () => {
        updateModelProviders()

        const modelType = model.models[0].model_type

        if (modelType)
          updateModelList(modelType)
      },
    })
  }

  const state = useCredentialPanelState(currentProvider)
  const { isChangingPriority, handleChangePriority } = useChangeProviderPriority(currentProvider)

  const isUsingCredits = state.priority === 'credits'
  const hasCredits = !state.isCreditsExhausted
  const isApiKeyActive = state.variant === 'api-active' || state.variant === 'api-fallback'
  const { credentialName } = state

  const handleCloseDropdown = useCallback(() => {
    setDropdownOpen(false)
    onHide()
  }, [onHide])

  if (!currentProvider)
    return null

  return (
    <div className="mb-1">
      <div className="sticky top-12 z-[2] flex h-[22px] items-center justify-between bg-components-panel-bg px-3 text-xs font-medium text-text-tertiary">
        <div
          className="flex cursor-pointer items-center"
          onClick={() => setCollapsed(prev => !prev)}
        >
          {model.label[language] || model.label.en_US}
          <span className={cn('i-custom-vender-solid-general-arrow-down-round-fill h-4 w-4 text-text-quaternary', collapsed && '-rotate-90')} />
        </div>
        <Popover open={dropdownOpen} onOpenChange={setDropdownOpen}>
          <PopoverTrigger
            render={(
              <button type="button" className="flex cursor-pointer items-center rounded-md px-1.5 py-1 text-text-tertiary system-xs-medium hover:bg-components-button-ghost-bg-hover">
                {isUsingCredits
                  ? (
                      hasCredits
                        ? (
                            <>
                              <CreditsCoin className="h-3 w-3" />
                              <span className="ml-1">{t('modelProvider.selector.aiCredits', { ns: 'common' })}</span>
                            </>
                          )
                        : (
                            <>
                              <span className="i-ri-alert-fill h-3 w-3 text-text-warning-secondary" />
                              <span className="ml-1 text-text-warning">{t('modelProvider.selector.creditsExhausted', { ns: 'common' })}</span>
                            </>
                          )
                    )
                  : credentialName
                    ? (
                        <>
                          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-[2px] border', isApiKeyActive ? 'border-components-badge-status-light-success-border-inner bg-components-badge-status-light-success-bg' : 'border-components-badge-status-light-error-border-inner bg-components-badge-status-light-error-bg')} />
                          <span className="ml-1 text-text-tertiary">{credentialName}</span>
                        </>
                      )
                    : (
                        <>
                          <span className="h-1.5 w-1.5 shrink-0 rounded-[2px] border border-components-badge-status-light-disabled-border-inner bg-components-badge-status-light-disabled-bg" />
                          <span className="ml-1 text-text-tertiary">{t('modelProvider.selector.configureRequired', { ns: 'common' })}</span>
                        </>
                      )}
                <span className="i-ri-arrow-down-s-line !h-[14px] !w-[14px] translate-y-px text-text-tertiary" />
              </button>
            )}
          />
          <PopoverContent placement="bottom-end">
            <DropdownContent
              provider={currentProvider}
              state={state}
              isChangingPriority={isChangingPriority}
              onChangePriority={handleChangePriority}
              onClose={handleCloseDropdown}
            />
          </PopoverContent>
        </Popover>
      </div>
      {!collapsed && model.models.map(modelItem => (
        <Tooltip key={modelItem.model}>
          <TooltipTrigger
            render={(
              <button
                type="button"
                className={cn('group relative flex h-8 w-full items-center gap-1 rounded-lg px-3 py-1.5 text-left', modelItem.status === ModelStatusEnum.active ? 'cursor-pointer hover:bg-state-base-hover' : 'cursor-not-allowed hover:bg-state-base-hover-alt')}
                onClick={() => handleSelect(model.provider, modelItem)}
              >
                <div className="flex items-center gap-2">
                  <ModelIcon
                    className={cn('h-5 w-5 shrink-0')}
                    provider={model}
                    modelName={modelItem.model}
                  />
                  <ModelName
                    className={cn('text-text-secondary system-sm-medium', modelItem.status !== ModelStatusEnum.active && 'opacity-60')}
                    modelItem={modelItem}
                  />
                </div>
                {
                  defaultModel?.model === modelItem.model && defaultModel.provider === currentProvider.provider && (
                    <span className="i-custom-vender-line-general-check h-4 w-4 shrink-0 text-text-accent" />
                  )
                }
                {
                  modelItem.status === ModelStatusEnum.noConfigure && (
                    <div
                      className="hidden cursor-pointer text-xs font-medium text-text-accent group-hover:block"
                      onClick={handleOpenModelModal}
                    >
                      {t('operation.add', { ns: 'common' }).toLocaleUpperCase()}
                    </div>
                  )
                }
              </button>
            )}
          />
          <TooltipContent
            placement="right"
            variant="plain"
            popupClassName="w-[206px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-3 backdrop-blur-sm"
          >
            <div className="flex flex-col gap-1">
              <div className="flex flex-col items-start gap-2">
                <ModelIcon
                  className={cn('h-5 w-5 shrink-0')}
                  provider={model}
                  modelName={modelItem.model}
                />
                <div className="text-wrap break-words text-text-primary system-md-medium">{modelItem.label[language] || modelItem.label.en_US}</div>
              </div>
              <div className="flex flex-wrap gap-1">
                {!!modelItem.model_type && (
                  <ModelBadge>
                    {modelTypeFormat(modelItem.model_type)}
                  </ModelBadge>
                )}
                {!!modelItem.model_properties.mode && (
                  <ModelBadge>
                    {(modelItem.model_properties.mode as string).toLocaleUpperCase()}
                  </ModelBadge>
                )}
                {!!modelItem.model_properties.context_size && (
                  <ModelBadge>
                    {sizeFormat(modelItem.model_properties.context_size as number)}
                  </ModelBadge>
                )}
              </div>
              {[ModelTypeEnum.textGeneration, ModelTypeEnum.textEmbedding, ModelTypeEnum.rerank].includes(modelItem.model_type as ModelTypeEnum)
                && modelItem.features?.some(feature => [ModelFeatureEnum.vision, ModelFeatureEnum.audio, ModelFeatureEnum.video, ModelFeatureEnum.document].includes(feature))
                && (
                  <div className="pt-2">
                    <div className="mb-1 text-text-tertiary system-2xs-medium-uppercase">{t('model.capabilities', { ns: 'common' })}</div>
                    <div className="flex flex-wrap gap-1">
                      {modelItem.features?.map(feature => (
                        <FeatureIcon
                          key={feature}
                          feature={feature}
                          showFeaturesLabel
                        />
                      ))}
                    </div>
                  </div>
                )}
            </div>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

export default PopupItem
