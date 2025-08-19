import { memo } from 'react'
import {
  RiEqualizer2Line,
  RiScales3Line,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import cn from '@/utils/classnames'

type ConfigModelProps = {
  className?: string
  onClick?: () => void
  loadBalancingEnabled?: boolean
  loadBalancingInvalid?: boolean
}
const ConfigModel = ({
  className,
  onClick,
  loadBalancingEnabled,
  loadBalancingInvalid,
}: ConfigModelProps) => {
  const { t } = useTranslation()

  if (loadBalancingEnabled && loadBalancingInvalid) {
    return (
      <div
        className='system-2xs-medium-uppercase flex h-[18px] items-center rounded-[5px] border border-text-warning bg-components-badge-bg-dimm px-1.5'
        onClick={onClick}
      >
        <RiScales3Line className='mr-0.5 h-3 w-3' />
        {t('common.modelProvider.auth.authorizationError')}
      </div>
    )
  }

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
      {
        !loadBalancingEnabled && (
          <>
            <RiEqualizer2Line className='mr-1 h-4 w-4' />
            {t('common.operation.config')}
          </>
        )
      }
      {
        loadBalancingEnabled && !loadBalancingInvalid && (
          <>
            <RiScales3Line className='mr-1 h-4 w-4' />
            {t('common.modelProvider.auth.configLoadBalancing')}
          </>
        )
      }
    </Button>
  )
}

export default memo(ConfigModel)
