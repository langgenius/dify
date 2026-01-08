'use client'

import type { SandboxProvider } from '@/service/use-sandbox-provider'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Indicator from '@/app/components/header/indicator'
import { cn } from '@/utils/classnames'

type ProviderCardProps = {
  provider: SandboxProvider
  isCurrent?: boolean
  onConfig: () => void
  onEnable?: () => void
  disabled?: boolean
}

const PROVIDER_ICONS: Record<string, string> = {
  e2b: '/sandbox-providers/e2b.svg',
  docker: '/sandbox-providers/docker.svg',
  local: '/sandbox-providers/local.svg',
}

const ProviderIcon = ({ providerType }: { providerType: string }) => {
  const iconSrc = PROVIDER_ICONS[providerType] || PROVIDER_ICONS.e2b

  return (
    <img
      src={iconSrc}
      alt={`${providerType} icon`}
      className="h-5 w-5"
    />
  )
}

const ProviderCard = ({
  provider,
  isCurrent = false,
  onConfig,
  onEnable,
  disabled = false,
}: ProviderCardProps) => {
  const { t } = useTranslation()

  const isConfigured = provider.is_tenant_configured || provider.is_system_configured
  const showEnableButton = !isCurrent && isConfigured && onEnable

  return (
    <div className={cn(
      'flex items-center justify-between rounded-xl p-4',
      isCurrent ? 'bg-background-section' : 'bg-background-section-burn',
    )}
    >
      <div className="flex items-center">
        {/* Icon */}
        <div className="mr-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-divider-subtle bg-background-default-subtle">
          <ProviderIcon providerType={provider.provider_type} />
        </div>

        {/* Content */}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="system-md-semibold text-text-primary">
              {provider.label}
            </span>
            {provider.is_system_configured && (
              <span className="system-2xs-medium-uppercase rounded border border-divider-regular px-1.5 py-0.5 text-text-tertiary">
                {t('sandboxProvider.managedBySaas', { ns: 'common' })}
              </span>
            )}
          </div>
          <div className="system-xs-regular text-text-tertiary">
            {provider.description}
          </div>
        </div>
      </div>

      {/* Right side: Connected Badge + Actions */}
      <div className="flex shrink-0 items-center gap-2">
        {isConfigured && (
          <span className="system-xs-medium flex items-center gap-1 rounded-md bg-util-colors-green-green-50 px-1.5 py-0.5 text-util-colors-green-green-600">
            <Indicator color="green" />
            {t('sandboxProvider.connected', { ns: 'common' })}
          </span>
        )}
        <Button
          variant="secondary"
          size="small"
          onClick={onConfig}
          disabled={disabled}
        >
          {t('sandboxProvider.config', { ns: 'common' })}
        </Button>
        {showEnableButton && (
          <Button
            variant="secondary"
            size="small"
            onClick={onEnable}
            disabled={disabled}
          >
            {t('sandboxProvider.enable', { ns: 'common' })}
          </Button>
        )}
      </div>
    </div>
  )
}

export default memo(ProviderCard)
