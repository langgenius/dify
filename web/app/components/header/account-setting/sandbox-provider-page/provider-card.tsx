'use client'

import type { SandboxProvider } from '@/service/use-sandbox-provider'
import { RiEqualizer2Line } from '@remixicon/react'
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
  daytona: '/sandbox-providers/daytona.svg',
  docker: '/sandbox-providers/docker.svg',
  local: '/sandbox-providers/local.svg',
}

const PROVIDER_DESCRIPTION_KEYS = {
  e2b: 'sandboxProvider.e2b.description',
  daytona: 'sandboxProvider.daytona.description',
  docker: 'sandboxProvider.docker.description',
  local: 'sandboxProvider.local.description',
} as const

const ProviderIcon = ({ providerType }: { providerType: string }) => {
  const iconSrc = PROVIDER_ICONS[providerType] || PROVIDER_ICONS.e2b
  return (
    <img
      src={iconSrc}
      alt={`${providerType} icon`}
      className="h-6 w-6"
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
    <div
      className={cn(
        'group flex items-center gap-3 rounded-[15px] py-3 pl-3 pr-4',
        'border-[0.5px] border-components-panel-border shadow-xs',
        isCurrent ? 'bg-background-section' : 'bg-background-section-burn',
      )}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center text-clip rounded-[10px] border-[0.5px] border-divider-subtle bg-background-default-subtle">
        <ProviderIcon providerType={provider.provider_type} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="system-md-semibold text-text-primary">
            {provider.label}
          </span>
          {provider.is_system_configured && (
            <span className="system-2xs-medium rounded-[5px] border border-divider-deep px-[5px] py-[3px] text-text-tertiary">
              {t('sandboxProvider.managedBySaas', { ns: 'common' })}
            </span>
          )}
        </div>
        <div className="system-xs-regular text-text-tertiary">
          {t(PROVIDER_DESCRIPTION_KEYS[provider.provider_type as keyof typeof PROVIDER_DESCRIPTION_KEYS] ?? 'sandboxProvider.e2b.description', { ns: 'common' })}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {isConfigured && (
          <div className="relative flex items-center">
            <span
              className={cn(
                'flex items-center gap-1 transition-opacity duration-200',
                showEnableButton && 'group-hover:opacity-0',
              )}
            >
              <Indicator color="green" />
              <span className="system-xs-semibold-uppercase text-util-colors-green-green-600">
                {t('sandboxProvider.connected', { ns: 'common' })}
              </span>
            </span>

            {showEnableButton && (
              <Button
                variant="secondary"
                size="small"
                onClick={onEnable}
                disabled={disabled}
                className="absolute left-0 top-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
              >
                {t('sandboxProvider.setAsActive', { ns: 'common' })}
              </Button>
            )}
          </div>
        )}

        {isConfigured && (
          <div className="pl-1">
            <div className="h-3 w-px bg-divider-regular" />
          </div>
        )}

        <button
          onClick={onConfig}
          disabled={disabled}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RiEqualizer2Line className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

export default memo(ProviderCard)
