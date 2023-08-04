import type { FC, ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Indicator from '../../../indicator'
import Operation from './Operation'
import Button from '@/app/components/base/button'

type ModelItemProps = {
  provider: { key: string; type: string; icon: ReactElement }
  onOpenModal: () => void
}

const ModelItem: FC<ModelItemProps> = ({
  provider,
  onOpenModal,
}) => {
  const { t } = useTranslation()

  return (
    <div className='mb-2 bg-gray-50 rounded-xl'>
      <div className='flex justify-between items-center px-4 h-14'>
        {provider.icon}
        <Button
          className='!px-3 !h-7 rounded-md bg-white !text-xs font-medium text-gray-700'
          onClick={onOpenModal}
        >
          {t(`common.operation.${provider.type}`)}
        </Button>
        <div className='flex items-center'>
          <Indicator className='mr-3' />
          <Button
            className='mr-1 !px-3 !h-7 rounded-md bg-white !text-xs font-medium text-gray-700'
            onClick={onOpenModal}
          >
            {t('common.operation.edit')}
          </Button>
          <Operation />
        </div>
      </div>
      <div className='px-3 pb-3'>
        <div className='flex mb-1 px-3 py-2 bg-white rounded-lg shadow-xs last:mb-0'>
          <div className='grow'>
            <div className='flex items-center mb-0.5 h-[18px] text-[13px] font-medium text-gray-700'>
              al6z-infra/llama136-v2-chat
              <div className='ml-2 px-1.5 rounded-md border border-[rgba(0,0,0,0.08)] text-xs text-gray-600'>Embeddings</div>
            </div>
            <div className='text-xs text-gray-500'>version: d7769041994d94e96ad9d568eac12laecf50684a060963625a41c4006126985</div>
          </div>
          <div className='flex items-center'>
            <Indicator className='mr-3' />
            <Button
              className='mr-1 !px-3 !h-7 rounded-md bg-white !text-xs font-medium text-gray-700'
              onClick={onOpenModal}
            >
              {t('common.operation.edit')}
            </Button>
            <Operation />
          </div>
        </div>
        <div className='flex mb-1 px-3 py-2 bg-white rounded-lg shadow-xs last:mb-0'>
          <div className='grow'>
            <div className='flex items-center mb-0.5 h-[18px] text-[13px] font-medium text-gray-700'>
              al6z-infra/llama136-v2-chat
              <div className='ml-2 px-1.5 rounded-md border border-[rgba(0,0,0,0.08)] text-xs text-gray-600'>Embeddings</div>
            </div>
            <div className='text-xs text-gray-500'>version: d7769041994d94e96ad9d568eac12laecf50684a060963625a41c4006126985</div>
          </div>
          <div className='flex items-center'>
            <Indicator className='mr-3' />
            <Button
              className='mr-1 !px-3 !h-7 rounded-md bg-white !text-xs font-medium text-gray-700'
              onClick={onOpenModal}
            >
              {t('common.operation.edit')}
            </Button>
            <Operation />
          </div>
        </div>
      </div>
    </div>
  )
}

export default ModelItem
