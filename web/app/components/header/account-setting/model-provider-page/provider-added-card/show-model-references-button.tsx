import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'
import { RiNodeTree } from '@remixicon/react'

type ShowModelReferencesButtonProps = {
  className?: string
  onClick: () => void
}
const ShowModelReferencesButton: FC<ShowModelReferencesButtonProps> = ({
  className,
  onClick,
}) => {
  const { t } = useTranslation()

  return (
    <span
      className={cn('system-xs-medium flex h-6 shrink-0 cursor-pointer items-center rounded-md px-1.5 text-text-tertiary hover:bg-components-button-ghost-bg-hover hover:text-components-button-ghost-text', className)}
      onClick={onClick}
    >
      <RiNodeTree className='mr-1 h-3 w-3' />
      {t('common.modelProvider.showModelReferences')}
    </span>
  )
}

export default ShowModelReferencesButton
