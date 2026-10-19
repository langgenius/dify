'use client'

import type { RequiredConnection } from './required-connections'
import type { ConnectionActions } from './service-connection-selector'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import ServiceConnectionSelector from './service-connection-selector'

export type ConnectionMethod = 'oauth' | 'api-key'

export type RequiredConnectionService = RequiredConnection & {
  description: string
  readmeUrl?: string
  availableConnections: readonly {
    id: string
    name: string
    method?: ConnectionMethod
    status?: 'active' | 'expired' | 'invalid'
  }[]
  selectedConnectionId?: string
  methods: readonly ConnectionMethod[]
}

type Props = ConnectionActions & {
  services: readonly RequiredConnectionService[]
  onConnect: (serviceId: string, method: ConnectionMethod) => void
  onConnectionChange: (serviceId: string, connectionId: string) => void
  disabled?: boolean
  className?: string
}

function ServiceItem({
  service,
  onConnect,
  onConnectionChange,
  disabled,
  onReconnect,
  onReplace,
  onRequestReplace,
  onRemove,
}: {
  service: RequiredConnectionService
} & Pick<
  Props,
  | 'onConnect'
  | 'onConnectionChange'
  | 'disabled'
  | 'onReconnect'
  | 'onReplace'
  | 'onRequestReplace'
  | 'onRemove'
>) {
  const { t } = useTranslation(['share'])
  const nameId = useId()
  const descriptionId = useId()
  const warningId = useId()
  const canOAuth = service.methods.includes('oauth')
  const canApiKey = service.methods.includes('api-key')
  const selectedConnection = service.availableConnections.find(
    (connection) => connection.id === service.selectedConnectionId,
  )
  const isExpired = selectedConnection?.status === 'expired'
  const isInvalid = selectedConnection?.status === 'invalid'

  return (
    <li
      aria-labelledby={nameId}
      className="grid grid-cols-[32px_minmax(0,1fr)] items-center gap-3 rounded-2xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg p-3 sm:grid-cols-[32px_minmax(0,1fr)_auto]"
    >
      <AppIcon
        size="small"
        icon={service.icon}
        fallback={{
          content: (
            <span
              className={cn(
                'size-6 text-text-secondary',
                service.iconClassName ?? 'i-ri-plug-line',
              )}
            />
          ),
          background: 'var(--color-background-default-dodge)',
        }}
        decorative
      />
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <span id={nameId} className="system-md-semibold wrap-anywhere text-text-primary">
          {service.name}
        </span>
        <span id={descriptionId} className="system-xs-regular wrap-anywhere text-text-tertiary">
          {service.description}
        </span>
        {(isExpired || isInvalid) && (
          <span id={warningId} className="system-xs-regular wrap-anywhere text-text-warning">
            {isInvalid
              ? t(($) => $['connections.apiKeys.warning'], { ns: 'share' })
              : t(($) => $['connections.accounts.expired'], { ns: 'share' })}
          </span>
        )}
      </div>
      <div className="col-start-2 flex max-w-full flex-wrap items-center gap-2 sm:col-start-auto">
        {service.availableConnections.length > 0 ? (
          <ServiceConnectionSelector
            service={service}
            labelledBy={nameId}
            describedBy={isExpired || isInvalid ? `${descriptionId} ${warningId}` : descriptionId}
            disabled={disabled}
            onConnect={onConnect}
            onConnectionChange={onConnectionChange}
            onReconnect={onReconnect}
            onReplace={onReplace}
            onRequestReplace={onRequestReplace}
            onRemove={onRemove}
          />
        ) : (
          <>
            {canOAuth && (
              <Button
                disabled={disabled}
                variant="secondary-accent"
                aria-describedby={`${nameId} ${descriptionId}`}
                onClick={() => onConnect(service.id, 'oauth')}
              >
                {t(($) => $['connections.setup.connect'], { ns: 'share' })}
              </Button>
            )}
            {canOAuth && canApiKey && (
              <span className="system-xs-regular text-text-quaternary">
                {t(($) => $['connections.setup.or'], { ns: 'share' })}
              </span>
            )}
            {canApiKey && (
              <Button
                disabled={disabled}
                variant="secondary-accent"
                aria-describedby={`${nameId} ${descriptionId}`}
                onClick={() => onConnect(service.id, 'api-key')}
              >
                {t(($) => $['connections.setup.addApiKey'], { ns: 'share' })}
              </Button>
            )}
          </>
        )}
      </div>
    </li>
  )
}

export default function RequiredServices({
  services,
  onConnect,
  onConnectionChange,
  disabled = false,
  onReconnect,
  onReplace,
  onRequestReplace,
  onRemove,
  className,
}: Props) {
  if (services.length === 0) return null

  return (
    <ul className={cn('flex flex-col gap-2', className)}>
      {services.map((service) => (
        <ServiceItem
          key={service.id}
          service={service}
          onConnect={onConnect}
          onConnectionChange={onConnectionChange}
          disabled={disabled}
          onReconnect={onReconnect}
          onReplace={onReplace}
          onRequestReplace={onRequestReplace}
          onRemove={onRemove}
        />
      ))}
    </ul>
  )
}
