import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import Indicator from '../../../indicator'
import Operation from './Operation'
import Button from '@/app/components/base/button'

type ModelItemProps = {
  provider: { key: string; type: string; icon: any }
  onOperate: () => void
}

const ModelItem: FC<ModelItemProps> = ({
  provider,
  onOperate,
}) => {
  const { t } = useTranslation()

  return (
    <div className='flex justify-between items-center mb-2 px-4 h-14 bg-gray-50 rounded-xl'>
      {provider.icon}
      <Button
        className='!px-3 !h-7 rounded-md bg-white !text-xs font-medium text-gray-700'
        onClick={onOperate}
      >
        {t(`common.operation.${provider.type}`)}
      </Button>
      <div className='flex items-center'>
        <Indicator className='mr-3' />
        <Button
          className='mr-1 !px-3 !h-7 rounded-md bg-white !text-xs font-medium text-gray-700'
          onClick={onOperate}
        >
          {t('common.operation.edit')}
        </Button>
        <Operation />
      </div>
    </div>
  )
}

export default ModelItem
