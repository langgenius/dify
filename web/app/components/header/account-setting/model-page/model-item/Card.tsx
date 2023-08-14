import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import Indicator from '../../../indicator'
import Selector from '../selector'
import type { Model, ProviderEnum } from '../declarations'
import { ProviderEnum as ProviderEnumValue } from '../declarations'
import Button from '@/app/components/base/button'

type CardProps = {
  providerType: ProviderEnum
  models: any[]
  onOpenModal: (v: any) => void
  onOperate: (v: Record<string, any>) => void
}

const Card: FC<CardProps> = ({
  providerType,
  models,
  onOpenModal,
  onOperate,
}) => {
  const { t } = useTranslation()

  const renderDesc = (model: Model) => {
    if (providerType === ProviderEnumValue.azure_openai)
      return model.config.openai_api_base
    if (providerType === ProviderEnumValue.replicate)
      return `version: ${model.config.model_version}`
    if (providerType === ProviderEnumValue.huggingface_hub)
      return model.config.huggingfacehub_endpoint_url
  }

  return (
    <div className='px-3 pb-3'>
      {
        models.map((model: Model) => (
          <div key={`${model.model_name}-${model.model_type}`} className='flex mb-1 px-3 py-2 bg-white rounded-lg shadow-xs last:mb-0'>
            <div className='grow'>
              <div className='flex items-center mb-0.5 h-[18px] text-[13px] font-medium text-gray-700'>
                {model.model_name}
                <div className='ml-2 px-1.5 rounded-md border border-[rgba(0,0,0,0.08)] text-xs text-gray-600'>{model.model_type}</div>
              </div>
              <div className='text-xs text-gray-500'>
                {renderDesc(model)}
              </div>
            </div>
            <div className='flex items-center'>
              <Indicator className='mr-3' />
              <Button
                className='mr-1 !px-3 !h-7 rounded-md bg-white !text-xs font-medium text-gray-700'
                onClick={() => onOpenModal({ model_name: model.model_name, model_type: model.model_type, ...model.config })}
              >
                {t('common.operation.edit')}
              </Button>
              <Selector
                hiddenOptions
                onOperate={v => onOperate({ ...v, value: model })}
                className={open => `${open && '!bg-gray-100 shadow-none'} flex justify-center items-center w-7 h-7 bg-white rounded-md border-[0.5px] border-gray-200 shadow-xs cursor-pointer hover:bg-gray-100`}
                deleteText={t('common.operation.remove') || ''}
              />
            </div>
          </div>
        ))
      }
    </div>
  )
}

export default Card
