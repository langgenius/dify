'use client'

import type { SandboxProvider } from '@/types/sandbox-provider'
import { RiEqualizer2Line } from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Indicator from '@/app/components/header/indicator'
import { IS_CLOUD_EDITION } from '@/config'
import { cn } from '@/utils/classnames'
import { PROVIDER_DESCRIPTION_KEYS, PROVIDER_STATIC_LABELS } from './constants'
import ProviderIcon from './provider-icon'

type ProviderCardProps = {
  provider: SandboxProvider
  isCurrent?: boolean
  onConfig: () => void
  onEnable?: () => void
  disabled?: boolean
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
  const showEnableButton = !disabled && !isCurrent && isConfigured && onEnable
  const providerLabel = PROVIDER_STATIC_LABELS[provider.provider_type as keyof typeof PROVIDER_STATIC_LABELS]
    ?? provider.provider_type

  return (
    <div
      className={cn(
        'group flex items-center gap-3 rounded-[15px] bg-background-section-burn py-3 pl-3',
        'border-[0.5px] border-components-panel-border shadow-xs',
        disabled ? 'pr-6' : 'pr-4',
      )}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center text-clip rounded-[10px] border-[0.5px] border-divider-subtle bg-background-default-subtle">
        <ProviderIcon providerType={provider.provider_type} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="text-text-primary system-md-semibold">
            {providerLabel}
          </span>
          {IS_CLOUD_EDITION && provider.is_system_configured && !provider.is_tenant_configured && (
            <span className="rounded-[5px] border border-divider-deep px-[5px] py-[3px] text-text-tertiary system-2xs-medium">
              {t('sandboxProvider.managedBySaas', { ns: 'common' })}
            </span>
          )}
        </div>
        <div className="text-text-tertiary system-xs-regular">
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
              <span className="text-util-colors-green-green-600 system-xs-semibold-uppercase">
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

        {!disabled && isConfigured && (
          <div className="pl-1">
            <div className="h-3 w-px bg-divider-regular" />
          </div>
        )}

        {!disabled && (
          <button
            onClick={onConfig}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
          >
            <RiEqualizer2Line className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}

export default memo(ProviderCard)
