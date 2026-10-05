import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

type ConfigModelProps = {
  onClick?: () => void
  loading?: boolean
  disabled?: boolean
  loadBalancingEnabled?: boolean
  loadBalancingInvalid?: boolean
  credentialRemoved?: boolean
}
const ConfigModel = ({
  onClick,
  loading,
  disabled,
  loadBalancingEnabled,
  loadBalancingInvalid,
  credentialRemoved,
}: ConfigModelProps) => {
  const { t } = useTranslation(['common', 'modelProvider'])

  if (loadBalancingInvalid) {
    return (
      <Button
        variant="ghost"
        size="small"
        loading={loading}
        disabled={disabled}
        className="relative h-4.5 rounded-[5px] border border-text-warning bg-components-badge-bg-dimm px-1.5 system-2xs-medium-uppercase text-text-warning shadow-none hover:bg-components-badge-bg-dimm"
        onClick={onClick}
      >
        <span aria-hidden className="i-ri-scales-3-line size-3" />
        {t(($) => $['modelProvider.auth.authorizationError'], { ns: 'modelProvider' })}
        <StatusDot status="warning" className="absolute -top-px -right-px size-1.5" />
      </Button>
    )
  }

  return (
    <Button
      variant="secondary"
      size="small"
      loading={loading}
      disabled={disabled}
      className={cn(
        'pointer-events-none absolute shrink-0 opacity-0 group-focus-within:pointer-events-auto group-focus-within:static group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:static group-hover:opacity-100',
        credentialRemoved && 'pointer-events-auto static opacity-100',
      )}
      onClick={onClick}
    >
      {credentialRemoved && (
        <>
          {t(($) => $['modelProvider.auth.credentialRemoved'], { ns: 'modelProvider' })}
          <StatusDot status="error" />
        </>
      )}
      {!loadBalancingEnabled && !credentialRemoved && !loadBalancingInvalid && (
        <>
          <span aria-hidden className="i-ri-equalizer-2-line size-4" />
          {t(($) => $['operation.config'], { ns: 'common' })}
        </>
      )}
      {loadBalancingEnabled && !credentialRemoved && !loadBalancingInvalid && (
        <>
          <span aria-hidden className="i-ri-scales-3-line size-4" />
          {t(($) => $['modelProvider.auth.configLoadBalancing'], { ns: 'modelProvider' })}
        </>
      )}
    </Button>
  )
}

export default memo(ConfigModel)
