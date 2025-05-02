import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { PlusCircle } from '@/app/components/base/icons/src/vender/solid/general'
import cn from '@/utils/classnames'

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
      className={cn('shrink-0 flex items-center px-1.5 h-6 text-text-tertiary system-xs-medium cursor-pointer hover:bg-components-button-ghost-bg-hover hover:text-components-button-ghost-text rounded-md', className)}
      onClick={onClick}
    >
      <PlusCircle className='mr-1 w-3 h-3' />
      {t('common.modelProvider.addModel')}
    </span>
  )
}

export default AddModelButton
