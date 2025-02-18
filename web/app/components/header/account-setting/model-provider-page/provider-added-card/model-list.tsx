import type { FC } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowRightSLine,
} from '@remixicon/react'
import type {
  CustomConfigurationModelFixedFields,
  ModelItem,
  ModelProvider,
} from '../declarations'
import {
  ConfigurationMethodEnum,
} from '../declarations'
// import Tab from './tab'
import AddModelButton from './add-model-button'
import ModelListItem from './model-list-item'
import { useModalContextSelector } from '@/context/modal-context'
import { useAppContext } from '@/context/app-context'

type ModelListProps = {
  provider: ModelProvider
  models: ModelItem[]
  onCollapse: () => void
  onConfig: (currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields) => void
  onChange?: (provider: string) => void
}
const ModelList: FC<ModelListProps> = ({
  provider,
  models,
  onCollapse,
  onConfig,
  onChange,
}) => {
  const { t } = useTranslation()
  const configurativeMethods = provider.configurate_methods.filter(method => method !== ConfigurationMethodEnum.fetchFromRemote)
  const { isCurrentWorkspaceManager } = useAppContext()
  const isConfigurable = configurativeMethods.includes(ConfigurationMethodEnum.customizableModel)

  const setShowModelLoadBalancingModal = useModalContextSelector(state => state.setShowModelLoadBalancingModal)
  const onModifyLoadBalancing = useCallback((model: ModelItem) => {
    setShowModelLoadBalancingModal({
      provider,
      model: model!,
      open: !!model,
      onClose: () => setShowModelLoadBalancingModal(null),
      onSave: onChange,
    })
  }, [onChange, provider, setShowModelLoadBalancingModal])

  return (
    <div className='rounded-b-xl px-2 pb-2'>
      <div className='bg-components-panel-bg rounded-lg py-1'>
        <div className='flex items-center pl-1 pr-[3px]'>
          <span className='group mr-2 flex shrink-0 items-center'>
            <span className='system-xs-medium text-text-tertiary inline-flex h-6 items-center pl-1 pr-1.5 group-hover:hidden'>
              {t('common.modelProvider.modelsNum', { num: models.length })}
              <RiArrowRightSLine className='mr-0.5 h-4 w-4 rotate-90' />
            </span>
            <span
              className='system-xs-medium text-text-tertiary bg-state-base-hover hidden h-6 cursor-pointer items-center rounded-lg pl-1 pr-1.5 group-hover:inline-flex'
              onClick={() => onCollapse()}
            >
              {t('common.modelProvider.modelsNum', { num: models.length })}
              <RiArrowRightSLine className='mr-0.5 h-4 w-4 rotate-90' />
            </span>
          </span>
          {/* {
            isConfigurable && canSystemConfig && (
              <span className='flex items-center'>
                <Tab active='all' onSelect={() => {}} />
              </span>
            )
          } */}
          {
            isConfigurable && isCurrentWorkspaceManager && (
              <div className='flex grow justify-end'>
                <AddModelButton onClick={() => onConfig()} />
              </div>
            )
          }
        </div>
        {
          models.map(model => (
            <ModelListItem
              key={model.model}
              {...{
                model,
                provider,
                isConfigurable,
                onConfig,
                onModifyLoadBalancing,
              }}
            />
          ))
        }
      </div>
    </div>
  )
}

export default ModelList
