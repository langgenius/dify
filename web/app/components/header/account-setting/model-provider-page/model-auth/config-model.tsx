import { memo } from 'react'
import { RiEqualizer2Line } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import cn from '@/utils/classnames'

type ConfigModelProps = {
  className?: string
  onClick?: () => void
}
const ConfigModel = ({
  className,
  onClick,
}: ConfigModelProps) => {
  const { t } = useTranslation()
  return (
    <Button
      variant='secondary'
      size='small'
      className={cn(
        'shrink-0',
        className,
      )}
      onClick={onClick}
    >
      <RiEqualizer2Line className='mr-1 h-4 w-4' />
      {t('common.operation.config')}
    </Button>
  )
}

export default memo(ConfigModel)
