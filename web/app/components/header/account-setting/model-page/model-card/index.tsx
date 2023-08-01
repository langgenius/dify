import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import s from './index.module.css'
import Button from '@/app/components/base/button'
import { Plus } from '@/app/components/base/icons/src/vender/line/general'

type ModelCardProps = {
  type?: 'openai' | 'anthropic'
}

const ModelCard: FC<ModelCardProps> = ({
  type = 'openai',
}) => {
  const { t } = useTranslation()

  return (
    <div className={cn(
      s.card,
      'rounded-xl border-[0.5px] border-gray-200',
    )}>
      <div className='flex px-4 pt-4 pb-3 bg-gray-200 rounded-t-lg'>
        <div className='mr-3'>
          <div className='mb-1'></div>
          <div className='text-xs text-black opacity-60'>{t(`common.modelProvider.card.${type}.desc`)}</div>
        </div>
        <div className='w-6 h-6' />
      </div>
      <div className='flex justify-between px-4 py-3 border-b-[0.5px] border-b-[rgba(0, 0, 0, 0.5)]'>
        <div>
          <div className='flex items-center mb-1 h-5'>
            <div className='mr-1 text-xs font-medium text-gray-500'>{t('common.modelProvider.card.quota')}</div>
            <div className='px-1.5 bg-primary-50 rounded-md text-xs font-semibold text-primary-600'>{t('common.modelProvider.card.onTrial')}</div>
          </div>
          <div className='flex items-center'>
            <div className='mr-1 text-sm font-medium text-gray-700'>200</div>
            <div className='mr-1 text-sm text-gray-700'>{t('common.modelProvider.card.callTimes')}</div>
          </div>
        </div>
        <Button className='mt-1.5 !px-3 !h-8 !text-[13px] font-medium rounded-lg' type='primary'>{t('common.modelProvider.card.buyQuota')}</Button>
      </div>
      <div className='flex items-center px-4 h-12'>
        <Plus className='mr-1.5 w-4 h-4 text-gray-500' />
        <div className='text-xs font-medium text-gray-500'>{t('common.modelProvider.addApiKey')}</div>
      </div>
    </div>
  )
}

export default ModelCard
