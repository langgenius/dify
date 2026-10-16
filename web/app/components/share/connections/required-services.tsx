'use client'

import type { RequiredConnection } from './required-connections'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'

export type ConnectionMethod = 'oauth' | 'api-key'

export type RequiredConnectionService = RequiredConnection & {
  description: string
  availableConnections: readonly { id: string; name: string }[]
  selectedConnectionId?: string
  methods: readonly ConnectionMethod[]
}

type Props = {
  services: readonly RequiredConnectionService[]
  onConnect: (serviceId: string, method: ConnectionMethod) => void
  onConnectionChange: (serviceId: string, connectionId: string) => void
  className?: string
}

function ServiceItem({
  service,
  onConnect,
  onConnectionChange,
}: {
  service: RequiredConnectionService
} & Pick<Props, 'onConnect' | 'onConnectionChange'>) {
  const { t } = useTranslation(['share'])
  const nameId = useId()
  const descriptionId = useId()
  const canOAuth = service.methods.includes('oauth')
  const canApiKey = service.methods.includes('api-key')

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
      </div>
      <div className="col-start-2 flex max-w-full flex-wrap items-center gap-2 sm:col-start-auto">
        {service.availableConnections.length > 0 ? (
          <Select<string>
            items={service.availableConnections.map((connection) => ({
              value: connection.id,
              label: connection.name,
            }))}
            value={service.selectedConnectionId ?? null}
            onValueChange={(value) => {
              if (value !== null) onConnectionChange(service.id, value)
            }}
          >
            <SelectTrigger
              aria-labelledby={nameId}
              aria-describedby={descriptionId}
              className="w-40 max-w-full"
            >
              <SelectValue
                placeholder={t(($) => $['connections.setup.selectConnection'], { ns: 'share' })}
              />
            </SelectTrigger>
            <SelectContent>
              {service.availableConnections.map((connection) => (
                <SelectItem key={connection.id} value={connection.id}>
                  {connection.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <>
            {canOAuth && (
              <Button
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
        />
      ))}
    </ul>
  )
}
