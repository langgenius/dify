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
      className={cn('text-text-tertiary system-xs-medium hover:bg-components-button-ghost-bg-hover hover:text-components-button-ghost-text flex h-6 shrink-0 cursor-pointer items-center rounded-md px-1.5', className)}
      onClick={onClick}
    >
      <PlusCircle className='mr-1 h-3 w-3' />
      {t('common.modelProvider.addModel')}
    </span>
  )
}

export default AddModelButton
