import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { PlusCircle } from '@/app/components/base/icons/src/vender/solid/general'

type AddModelButtonProps = {
  className?: string
  onClick: () => void
}
const AddModelButton: FC<AddModelButtonProps> = ({
  className,
  onClick,
}) => {
  const { t } = useTranslation()

  return (
    <span
      className={`
        shrink-0 flex items-center px-1.5 h-6 text-xs font-medium text-gray-500 cursor-pointer
      hover:bg-primary-50 hover:text-primary-600 rounded-md ${className}
      `}
      onClick={onClick}
    >
      <PlusCircle className='mr-1 w-3 h-3' />
      {t('common.modelProvider.addModel')}
    </span>
  )
}

export default AddModelButton
