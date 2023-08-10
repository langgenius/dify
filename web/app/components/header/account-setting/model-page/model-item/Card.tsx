import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import Indicator from '../../../indicator'
import Operation from './Operation'
import Button from '@/app/components/base/button'

type CardProps = {
  models: any[]
  onOpenModal: (v: any) => void
  onOperate: (v: Record<string, string>) => void
}

const Card: FC<CardProps> = ({
  models,
  onOpenModal,
  onOperate,
}) => {
  const { t } = useTranslation()

  return (
    <div className='px-3 pb-3'>
      {
        models.map((model: any) => (
          <div className='flex mb-1 px-3 py-2 bg-white rounded-lg shadow-xs last:mb-0'>
            <div className='grow'>
              <div className='flex items-center mb-0.5 h-[18px] text-[13px] font-medium text-gray-700'>
                {model.model_name}
                <div className='ml-2 px-1.5 rounded-md border border-[rgba(0,0,0,0.08)] text-xs text-gray-600'>{model.model_type}</div>
              </div>
              <div className='text-xs text-gray-500'>
                {
                  model.config.model_version
                    ? `version: ${model.config.model_version}`
                    : model.config.openai_api_base
                }
              </div>
            </div>
            <div className='flex items-center'>
              <Indicator className='mr-3' />
              <Button
                className='mr-1 !px-3 !h-7 rounded-md bg-white !text-xs font-medium text-gray-700'
                onClick={() => onOpenModal({ ...model, ...model.config })}
              >
                {t('common.operation.edit')}
              </Button>
              <Operation onOperate={v => onOperate({ ...v, value: model })} />
            </div>
          </div>
        ))
      }
    </div>
  )
}

export default Card
