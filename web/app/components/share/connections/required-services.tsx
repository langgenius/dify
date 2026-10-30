'use client'

import type {
  ConnectionPreflightStatus,
  ProviderConfig,
  WebAppConnectionRequirement,
} from '@dify/contracts/api/web/types.gen'
import type { ApiKeyValues } from './api-key-form'
import type { RequiredConnection } from './required-connections'
import type { ConnectionActions } from './service-connection-selector'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { reportClientError } from '@/service/client-error'
import ApiKeyDialog from './api-key-dialog'
import ConnectionServiceItem from './connection-service-item'
import { getServiceConnectionStatus } from './connection-status'
import RemoveConnectionDialog from './remove-connection-dialog'
import ServiceConnectionSelector from './service-connection-selector'

export type ConnectionMethod = 'oauth' | 'api-key'

export type RequiredConnectionService = RequiredConnection & {
  description: string
  iconDark?: RequiredConnection['icon']
  pluginUniqueIdentifier?: WebAppConnectionRequirement['plugin_unique_identifier']
  apiKeySchema?: ProviderConfig[]
  availableConnections: readonly {
    id: string
    name: string
    method?: ConnectionMethod
    status?: 'active' | 'expired' | 'invalid'
  }[]
  selectedConnectionId?: string
  preflight?: ConnectionPreflightStatus
  methods: readonly ConnectionMethod[]
}

type Props = ConnectionActions & {
  services: readonly RequiredConnectionService[]
  onConnect: (
    serviceId: string,
    method: ConnectionMethod,
    values?: ApiKeyValues,
  ) => void | Promise<void>
  onConnectionChange: (serviceId: string, connectionId: string) => void
  disabled?: boolean
  isMutating?: boolean
  showMissingConnectionWarning?: boolean
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
  onRequestAddApiKey,
  onRemove,
  showMissingConnectionWarning,
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
  | 'onRequestAddApiKey'
  | 'onRemove'
  | 'showMissingConnectionWarning'
>) {
  const { t } = useTranslation(['share', 'common'])
  const rowRef = useRef<HTMLLIElement>(null)
  const addApiKeyTriggerRef = useRef<HTMLButtonElement>(null)
  const [addApiKeyOpen, setAddApiKeyOpen] = useState(false)
  const [removal, setRemoval] = useState<
    RequiredConnectionService['availableConnections'][number] | null
  >(null)
  const [removeOpen, setRemoveOpen] = useState(false)
  const canOAuth = service.methods.includes('oauth')
  const canApiKey = service.methods.includes('api-key')
  const selectedConnection = service.availableConnections.find(
    (connection) => connection.id === service.selectedConnectionId,
  )
  const connectionStatus = getServiceConnectionStatus(service, selectedConnection)
  const isExpired = connectionStatus === 'reconnect_required'
  const isInvalid = connectionStatus === 'invalid'
  const isDisconnected =
    connectionStatus === 'disconnected' &&
    Boolean(selectedConnection || showMissingConnectionWarning)
  const checkUnavailable = connectionStatus === null
  const hasWarning = isExpired || isInvalid || isDisconnected || checkUnavailable

  return (
    <>
      <ConnectionServiceItem
        ref={rowRef}
        icon={service.icon}
        iconDark={service.iconDark}
        iconClassName={service.iconClassName}
        name={service.name}
        description={service.description}
        warning={
          hasWarning ? (
            <>
              {checkUnavailable
                ? t(($) => $['api.actionFailed'], { ns: 'common' })
                : isDisconnected
                  ? t(($) => $['connections.setup.selectConnection'], { ns: 'share' })
                  : isInvalid
                    ? selectedConnection?.method === 'api-key'
                      ? t(($) => $['connections.apiKeys.warning'], { ns: 'share' })
                      : t(($) => $['connections.accounts.reconnectRequired'], { ns: 'share' })
                    : t(($) => $['connections.accounts.expired'], { ns: 'share' })}
            </>
          ) : undefined
        }
        renderControls={({ labelledBy, describedBy }) => (
          <>
            {service.availableConnections.length > 0 ? (
              <ServiceConnectionSelector
                service={service}
                showMissingConnectionWarning={showMissingConnectionWarning}
                labelledBy={labelledBy}
                describedBy={describedBy}
                disabled={disabled}
                onConnect={onConnect}
                onConnectionChange={onConnectionChange}
                onReconnect={onReconnect}
                onReplace={onReplace}
                onRequestReplace={onRequestReplace}
                onRequestAddApiKey={onRequestAddApiKey}
                onRemove={onRemove}
                onRequestRemove={(connectionId) => {
                  if (disabled || !onRemove) return
                  const connection = service.availableConnections.find(
                    (item) => item.id === connectionId,
                  )
                  if (!connection) return
                  setRemoval(connection)
                  setRemoveOpen(true)
                }}
              />
            ) : (
              <>
                {canOAuth && (
                  <Button
                    disabled={disabled}
                    variant="secondary-accent"
                    aria-describedby={`${labelledBy} ${describedBy}`}
                    onClick={async () => {
                      try {
                        await onConnect(service.id, 'oauth')
                      } catch (error) {
                        reportClientError(error)
                      }
                    }}
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
                    ref={addApiKeyTriggerRef}
                    focusableWhenDisabled
                    disabled={disabled}
                    variant="secondary-accent"
                    aria-describedby={`${labelledBy} ${describedBy}`}
                    onClick={() => {
                      if (disabled) return
                      if (onRequestAddApiKey) onRequestAddApiKey(service.id)
                      else setAddApiKeyOpen(true)
                    }}
                  >
                    {t(($) => $['connections.setup.addApiKey'], { ns: 'share' })}
                  </Button>
                )}
              </>
            )}
          </>
        )}
      />
      <ApiKeyDialog
        serviceId={service.id}
        schemas={service.apiKeySchema}
        mode="add"
        open={addApiKeyOpen}
        onOpenChange={setAddApiKeyOpen}
        onSave={(values) => onConnect(service.id, 'api-key', values)}
        finalFocus={() => addApiKeyTriggerRef.current ?? rowRef.current}
        disabled={disabled}
      />
      {removal && (
        <RemoveConnectionDialog
          key={removal.id}
          name={removal.name}
          method={removal.method}
          open={removeOpen}
          onOpenChange={setRemoveOpen}
          onConfirm={() => onRemove?.(service.id, removal.id)}
          finalFocus={() =>
            rowRef.current?.querySelector<HTMLElement>('button:not(:disabled)') ?? rowRef.current
          }
          disabled={disabled || !onRemove}
        />
      )}
    </>
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
  onRequestAddApiKey,
  onRemove,
  className,
  isMutating = false,
  showMissingConnectionWarning = false,
}: Props) {
  const actionsDisabled = disabled || isMutating
  if (services.length === 0) return null

  return (
    <ul className={cn('flex flex-col gap-2', className)}>
      {services.map((service) => (
        <ServiceItem
          key={service.id}
          service={service}
          showMissingConnectionWarning={showMissingConnectionWarning}
          onConnect={onConnect}
          onConnectionChange={onConnectionChange}
          disabled={actionsDisabled}
          onReconnect={onReconnect}
          onReplace={onReplace}
          onRequestReplace={onRequestReplace}
          onRequestAddApiKey={onRequestAddApiKey}
          onRemove={onRemove}
        />
      ))}
    </ul>
  )
}
