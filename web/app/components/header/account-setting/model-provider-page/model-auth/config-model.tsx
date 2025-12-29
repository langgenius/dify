import {
  RiEqualizer2Line,
  RiScales3Line,
} from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Indicator from '@/app/components/header/indicator'
import { cn } from '@/utils/classnames'

type ConfigModelProps = {
  onClick?: () => void
  loadBalancingEnabled?: boolean
  loadBalancingInvalid?: boolean
  credentialRemoved?: boolean
}
const ConfigModel = ({
  onClick,
  loadBalancingEnabled,
  loadBalancingInvalid,
  credentialRemoved,
}: ConfigModelProps) => {
  const { t } = useTranslation()

  if (loadBalancingInvalid) {
    return (
      <div
        className="system-2xs-medium-uppercase relative flex h-[18px] cursor-pointer items-center rounded-[5px] border border-text-warning bg-components-badge-bg-dimm px-1.5 text-text-warning"
        onClick={onClick}
      >
        <RiScales3Line className="mr-0.5 h-3 w-3" />
        {t('modelProvider.auth.authorizationError', { ns: 'common' })}
        <Indicator color="orange" className="absolute right-[-1px] top-[-1px] h-1.5 w-1.5" />
      </div>
    )
  }

  return (
    <Button
      variant="secondary"
      size="small"
      className={cn(
        'hidden shrink-0 group-hover:flex',
        credentialRemoved && 'flex',
      )}
      onClick={onClick}
    >
      {
        credentialRemoved && (
          <>
            {t('modelProvider.auth.credentialRemoved', { ns: 'common' })}
            <Indicator color="red" className="ml-2" />
          </>
        )
      }
      {
        !loadBalancingEnabled && !credentialRemoved && !loadBalancingInvalid && (
          <>
            <RiEqualizer2Line className="mr-1 h-4 w-4" />
            {t('operation.config', { ns: 'common' })}
          </>
        )
      }
      {
        loadBalancingEnabled && !credentialRemoved && !loadBalancingInvalid && (
          <>
            <RiScales3Line className="mr-1 h-4 w-4" />
            {t('modelProvider.auth.configLoadBalancing', { ns: 'common' })}
          </>
        )
      }
    </Button>
  )
}

export default memo(ConfigModel)
