import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { Edit02, Trash03 } from '@/app/components/base/icons/src/vender/line/general'
import type { ApiBasedExtension } from '@/models/common'

type ItemProps = {
  data: ApiBasedExtension
}
const Item: FC<ItemProps> = ({
  data,
}) => {
  const { t } = useTranslation()

  return (
    <div className='group flex items-center mb-2 px-4 py-2 border-[0.5px] border-transparent rounded-xl bg-gray-50 hover:border-gray-200 hover:shadow-xs'>
      <div className='grow'>
        <div className='mb-0.5 text-[13px] font-medium text-gray-700'>{data.name}</div>
        <div className='text-xs text-gray-500'>{data.api_endpoint}</div>
      </div>
      <div className='hidden group-hover:flex items-center'>
        <div className='flex items-center mr-1 px-3 h-7 text-xs font-medium text-gray-700 rounded-md border-[0.5px] border-gray-200 shadow-xs cursor-pointer'>
          <Edit02 className='mr-[5px] w-3.5 h-3.5' />
          {t('common.operation.edit')}
        </div>
        <div className='flex items-center justify-center w-7 h-7 text-gray-700 rounded-md border-[0.5px] border-gray-200 shadow-xs cursor-pointer'>
          <Trash03 className='w-4 h-4' />
        </div>
      </div>
    </div>
  )
}

export default Item
