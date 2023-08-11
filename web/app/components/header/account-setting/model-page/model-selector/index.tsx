import type { FC } from 'react'
import { Fragment, useState } from 'react'
import { Popover, Transition } from '@headlessui/react'
import { useTranslation } from 'react-i18next'
import _ from 'lodash-es'
import cn from 'classnames'
import type { BackendModel, ProviderEnum } from '@/app/components/header/account-setting/model-page/declarations'
import { ModelType } from '@/app/components/header/account-setting/model-page/declarations'
import { ChevronDown } from '@/app/components/base/icons/src/vender/line/arrows'
import { Check, SearchLg } from '@/app/components/base/icons/src/vender/line/general'
import { XCircle } from '@/app/components/base/icons/src/vender/solid/general'
import { AlertCircle } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import Tooltip from '@/app/components/base/tooltip'
import ModelIcon from '@/app/components/app/configuration/config-model/model-icon'
import ModelName, { supportI18nModelName } from '@/app/components/app/configuration/config-model/model-name'
import ProviderName from '@/app/components/app/configuration/config-model/provider-name'
import { useProviderContext } from '@/context/provider-context'
type Props = {
  value: {
    providerName: ProviderEnum
    modelName: string
  } | undefined
  modelType: ModelType
  supportAgentThought?: boolean
  onChange: (value: BackendModel) => void
  popClassName?: string
  readonly?: boolean
  triggerIconSmall?: boolean
}

const ModelSelector: FC<Props> = ({
  value,
  modelType,
  supportAgentThought,
  onChange,
  popClassName,
  readonly,
  triggerIconSmall,
}) => {
  const { t } = useTranslation()
  const { textGenerationModelList, embeddingsModelList, speech2textModelList, agentThoughtModelList } = useProviderContext()
  const [search, setSearch] = useState('')
  const modelList = supportAgentThought
    ? agentThoughtModelList
    : ({
      [ModelType.textGeneration]: textGenerationModelList,
      [ModelType.embeddings]: embeddingsModelList,
      [ModelType.speech2text]: speech2textModelList,
    })[modelType]
  const allModelNames = (() => {
    if (!search)
      return {}

    const res: Record<string, string> = {}
    modelList.forEach(({ model_name }) => {
      res[model_name] = supportI18nModelName.includes(model_name) ? t(`common.modelName.${model_name}`) : model_name
    })
    return res
  })()
  const filteredModelList = search
    ? modelList.filter(({ model_name }) => {
      if (allModelNames[model_name].includes(search))
        return true

      return false
    })
    : modelList

  const hasRemoved = value && !modelList.find(({ model_name }) => model_name === value.modelName)

  const modelOptions: any[] = (() => {
    const providers = _.uniq(filteredModelList.map(item => item.model_provider.provider_name))
    const res: any[] = []
    providers.forEach((providerName) => {
      res.push({
        type: 'provider',
        value: providerName,
      })
      const models = filteredModelList.filter(m => m.model_provider.provider_name === providerName)
      models.forEach(({ model_name }) => {
        res.push({
          type: 'model',
          providerName,
          value: model_name,
        })
      })
    })
    return res
  })()

  return (
    <div className=''>
      <Popover className='relative'>
        <Popover.Button className={cn('flex items-center px-2.5 w-full h-9 rounded-lg', readonly ? '!cursor-auto' : 'bg-gray-100', hasRemoved && '!bg-[#FEF3F2]')}>
          {
            ({ open }) => (
              <>
                {
                  value
                    ? (
                      <>
                        <ModelIcon
                          className={cn('mr-1.5', !triggerIconSmall && 'w-5 h-5')}
                          modelId={value.modelName}
                          providerName={value.providerName}
                        />
                        <div className='mr-1.5 grow text-left text-sm text-gray-900 truncate'><ModelName modelId={value.modelName} /></div>
                      </>
                    )
                    : (
                      <div className='grow text-left text-sm text-gray-800 opacity-60'>{t('common.modelProvider.selectModel')}</div>
                    )
                }
                {
                  hasRemoved && (
                    <Tooltip
                      selector='model-selector-remove-tip'
                      htmlContent={
                        <div className='w-[261px] text-gray-500'>{t('common.modelProvider.selector.tip')}</div>
                      }
                    >
                      <AlertCircle className='mr-1 w-4 h-4 text-[#F04438]' />
                    </Tooltip>
                  )
                }
                {!readonly && <ChevronDown className={`w-4 h-4 text-gray-700 ${open ? 'opacity-100' : 'opacity-60'}`} />}
              </>
            )
          }
        </Popover.Button>
        {!readonly && (
          <Transition
            as={Fragment}
            leave='transition ease-in duration-100'
            leaveFrom='opacity-100'
            leaveTo='opacity-0'
          >
            <Popover.Panel className={cn(popClassName, 'absolute top-10 p-1 min-w-[232px] max-w-[260px] max-h-[366px] bg-white border-[0.5px] border-gray-200 rounded-lg shadow-lg overflow-auto z-10')}>
              <div className='px-2 pt-2 pb-1'>
                <div className='flex items-center px-2 h-8 bg-gray-100 rounded-lg'>
                  <div className='mr-1.5 p-[1px]'><SearchLg className='w-[14px] h-[14px] text-gray-400' /></div>
                  <div className='grow px-0.5'>
                    <input
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className={`
                      block w-full h-8 bg-transparent text-[13px] text-gray-700
                      outline-none appearance-none border-none
                    `}
                      placeholder={t('common.modelProvider.searchModel') || ''}
                    />
                  </div>
                  {
                    search && (
                      <div className='ml-1 p-0.5 cursor-pointer' onClick={() => setSearch('')}>
                        <XCircle className='w-3 h-3 text-gray-400' />
                      </div>
                    )
                  }
                </div>
              </div>
              {
                modelOptions.map((model: any) => {
                  if (model.type === 'provider') {
                    return (
                      <div
                        className='px-3 pt-2 pb-1 text-xs font-medium text-gray-500'
                        key={`${model.type}-${model.value}`}
                      >
                        <ProviderName provideName={model.value} />
                      </div>
                    )
                  }

                  if (model.type === 'model') {
                    return (
                      <Popover.Button
                        key={`${model.providerName}-${model.value}`}
                        className={`
                        flex items-center px-3 w-full h-8 rounded-lg hover:bg-gray-50
                        ${!readonly ? 'cursor-pointer' : 'cursor-auto'}
                        ${(value?.providerName === model.providerName && value?.modelName === model.value) && 'bg-gray-50'}
                      `}
                        onClick={() => {
                          const selectedModel = modelList.find((item) => {
                            return item.model_name === model.value && item.model_provider.provider_name === model.providerName
                          })
                          onChange(selectedModel as BackendModel)
                        }}
                      >
                        <ModelIcon
                          className='mr-2 shrink-0'
                          modelId={model.value}
                          providerName={model.providerName}
                        />
                        <div className='grow text-left text-sm text-gray-900 truncate'><ModelName modelId={model.value} /></div>
                        { (value?.providerName === model.providerName && value?.modelName === model.value) && <Check className='shrink-0 w-4 h-4 text-primary-600' /> }
                      </Popover.Button>
                    )
                  }

                  return null
                })
              }
              {(search && filteredModelList.length === 0) && (
                <div className='px-3 pt-1.5 h-[30px] text-center text-xs text-gray-500'>{t('common.modelProvider.noModelFound', { model: search })}</div>
              )}
            </Popover.Panel>
          </Transition>
        )}
      </Popover>
    </div>
  )
}

export default ModelSelector
