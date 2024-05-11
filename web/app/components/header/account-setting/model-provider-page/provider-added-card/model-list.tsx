import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  CustomConfigrationModelFixedFields,
  ModelItem,
  ModelProvider,
} from '../declarations'
import {
  ConfigurateMethodEnum,
  ModelStatusEnum,
} from '../declarations'
import { useLanguage } from '../hooks'
import ModelIcon from '../model-icon'
import ModelName from '../model-name'
// import Tab from './tab'
import ModelBadge from '../model-badge'
import AddModelButton from './add-model-button'
import { Settings01 } from '@/app/components/base/icons/src/vender/line/general'
import { ChevronDownDouble } from '@/app/components/base/icons/src/vender/line/arrows'
import Button from '@/app/components/base/button'
import Switch from '@/app/components/base/switch'
import { Balance } from '@/app/components/base/icons/src/vender/line/financeAndECommerce'

type ModelListProps = {
  provider: ModelProvider
  models: ModelItem[]
  onCollapse: () => void
  onConfig: (currentCustomConfigrationModelFixedFields?: CustomConfigrationModelFixedFields) => void
}
const ModelList: FC<ModelListProps> = ({
  provider,
  models,
  onCollapse,
  onConfig,
}) => {
  const { t } = useTranslation()
  const language = useLanguage()
  const configurateMethods = provider.configurate_methods.filter(method => method !== ConfigurateMethodEnum.fetchFromRemote)
  const canCustomConfig = configurateMethods.includes(ConfigurateMethodEnum.customizableModel)
  // const canSystemConfig = configurateMethods.includes(ConfigurateMethodEnum.predefinedModel)

  return (
    <div className='px-2 pb-2 rounded-b-xl'>
      <div className='py-1 bg-white rounded-lg'>
        <div className='flex items-center pl-1 pr-[3px]'>
          <span className='group shrink-0 flex items-center mr-2'>
            <span className='group-hover:hidden pl-1 pr-1.5 h-6 leading-6 text-xs font-medium text-gray-500'>
              {t('common.modelProvider.modelsNum', { num: models.length })}
            </span>
            <span
              className='hidden group-hover:inline-flex items-center pl-1 pr-1.5 h-6 text-xs font-medium text-gray-500 bg-gray-50 cursor-pointer rounded-lg'
              onClick={() => onCollapse()}
            >
              <ChevronDownDouble className='mr-0.5 w-3 h-3 rotate-180' />
              {t('common.modelProvider.collapse')}
            </span>
          </span>
          {/* {
            canCustomConfig && canSystemConfig && (
              <span className='flex items-center'>
                <Tab active='all' onSelect={() => {}} />
              </span>
            )
          } */}
          {
            canCustomConfig && (
              <div className='grow flex justify-end'>
                <AddModelButton onClick={() => onConfig()} />
              </div>
            )
          }
        </div>
        {
          models.map(model => (
            <div
              key={model.model}
              className={`
                group flex items-center pl-2 pr-2.5 h-8 rounded-lg
                ${canCustomConfig && 'hover:bg-gray-50'}
                ${model.deprecated && 'opacity-60'}
              `}
            >
              <ModelIcon
                className='shrink-0 mr-2'
                provider={provider}
                modelName={model.model}
              />
              <ModelName
                className='grow text-sm font-normal text-gray-900'
                modelItem={model}
                showModelType
                showMode
                showContextSize
              >
                {/* TODO: check feature switch */}
                <ModelBadge className='ml-1 uppercase text-indigo-600 border-indigo-300'>
                  <Balance className='w-3 h-3 mr-0.5' />
                  {t('common.modelProvider.loadBalancing')}
                </ModelBadge>
              </ModelName>
              <div className='shrink-0 flex items-center'>
                {
                  model.fetch_from === ConfigurateMethodEnum.customizableModel && (
                    <Button
                      className='hidden group-hover:flex py-0 h-7 text-xs font-medium text-gray-700'
                      onClick={() => onConfig({ __model_name: model.model, __model_type: model.model_type })}
                    >
                      <Settings01 className='mr-[5px] w-3.5 h-3.5' />
                      {t('common.modelProvider.config')}
                    </Button>
                  )
                }
                {/* <Indicator
                  className='ml-2.5'
                  color={model.status === ModelStatusEnum.active ? 'green' : 'gray'}
                /> */}
                {/* TODO: check feature switch */}
                {!model.deprecated && [ModelStatusEnum.active, ModelStatusEnum.disabled].includes(model.status) && (
                  <Button className='opacity-0 group-hover:opacity-100 m-2 px-3 h-[28px] text-xs text-gray-700 rounded-md transition-opacity'>
                    <Balance className='mr-1 w-[14px] h-[14px]' />
                    {t('common.modelProvider.configLoadBalancing')}
                  </Button>
                )}
                <Switch
                  defaultValue={model.deprecated ? false : model?.status === ModelStatusEnum.active}
                  disabled={model.deprecated || ![ModelStatusEnum.active, ModelStatusEnum.disabled].includes(model.status)}
                  size='md'
                  onChange={async value => value}
                />
              </div>
            </div>
          ))
        }
      </div>
    </div>
  )
}

export default ModelList
