import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'

type ModelItemProps = {
  type?: string
}

const ModelItem: FC<ModelItemProps> = ({
  type = 'specific',
}) => {
  const { t } = useTranslation()

  return (
    <div className='flex justify-between items-center mb-2 px-4 h-14 bg-gray-50 rounded-xl'>
      <div />
      <Button className='!px-3 !h-7 rounded-md bg-white !text-xs font-medium text-gray-700'>{t(`common.operation.${type === 'specific' ? 'add' : 'setup'}`)}</Button>
    </div>
  )
}

export default ModelItem
