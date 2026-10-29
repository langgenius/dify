'use client'

import type { RefObject } from 'react'
import type { ApiKeyValues } from './api-key-form'
import type { RequiredConnectionService } from './required-services'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@langgenius/dify-ui/menu'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { reportClientError } from '@/service/client-error'
import ApiKeyDialog from './api-key-dialog'
import { getServiceConnectionStatus } from './connection-status'
import RemoveConnectionDialog from './remove-connection-dialog'

export type ConnectionActions = {
  onReconnect?: (serviceId: string, connectionId: string) => void | Promise<void>
  onReplace?: (
    serviceId: string,
    connectionId: string,
    values: ApiKeyValues,
  ) => void | Promise<void>
  onRemove?: (serviceId: string, connectionId: string) => void | Promise<void>
  onRequestReplace?: (serviceId: string, connectionId: string) => void
  onRequestAddApiKey?: (serviceId: string) => void
}

type Connection = RequiredConnectionService['availableConnections'][number]

type Props = ConnectionActions & {
  service: RequiredConnectionService
  labelledBy: string
  describedBy: string
  disabled?: boolean
  onConnect: (
    serviceId: string,
    method: RequiredConnectionService['methods'][number],
    values?: ApiKeyValues,
  ) => void | Promise<void>
  onConnectionChange: (serviceId: string, connectionId: string) => void
  onRequestRemove?: (connectionId: string) => void
}

function SelectionMark({ selected }: { selected: boolean }) {
  return (
    <span className="flex size-4.5 shrink-0 items-center justify-center" aria-hidden="true">
      {selected && <span className="i-ri-check-line size-3.5 text-text-accent" />}
    </span>
  )
}

function AccountActions({
  connection,
  serviceId,
  disabled,
  returnFocus,
  onReconnect,
  onRequestReplace,
  onRequestRemove,
}: Pick<ConnectionActions, 'onReconnect'> & {
  connection: Connection
  serviceId: string
  disabled?: boolean
  returnFocus: RefObject<HTMLButtonElement | null>
  onRequestReplace?: () => void
  onRequestRemove?: () => void
}) {
  const { t } = useTranslation(['share'])
  const transferringFocusRef = useRef(false)
  const canReconnect =
    !!onReconnect && connection.method !== 'api-key' && connection.status !== 'expired'
  const canReplace = !!onRequestReplace && connection.method === 'api-key'
  if (!onRequestRemove && !canReconnect && !canReplace) return null

  return (
    <Menu
      onOpenChange={(nextOpen) => {
        if (nextOpen) transferringFocusRef.current = false
      }}
    >
      <MenuTrigger
        render={
          <IconButton
            size="lg"
            disabled={disabled}
            aria-label={t(($) => $['connections.accounts.moreActions'], {
              ns: 'share',
              account: connection.name,
            })}
          >
            <span className="i-ri-more-fill size-4" aria-hidden="true" />
          </IconButton>
        }
      />
      <MenuContent
        className="w-50 max-w-(--available-width)"
        align="end"
        finalFocus={() => (transferringFocusRef.current ? false : returnFocus.current)}
      >
        {canReplace && (
          <MenuItem
            disabled={disabled}
            onClick={() => {
              transferringFocusRef.current = true
              onRequestReplace()
            }}
          >
            {t(($) => $['connections.apiKeys.replaceTitle'], { ns: 'share' })}
          </MenuItem>
        )}
        {canReconnect && (
          <MenuItem
            disabled={disabled}
            onClick={async () => {
              try {
                await onReconnect?.(serviceId, connection.id)
              } catch (error) {
                reportClientError(error)
              }
            }}
          >
            {t(($) => $['connections.accounts.reconnect'], { ns: 'share' })}
          </MenuItem>
        )}
        {onRequestRemove && (
          <MenuItem
            variant="destructive"
            disabled={disabled}
            onClick={() => {
              transferringFocusRef.current = true
              onRequestRemove()
            }}
          >
            {connection.method === 'api-key'
              ? t(($) => $['connections.apiKeys.remove'], { ns: 'share' })
              : t(($) => $['connections.accounts.remove'], { ns: 'share' })}
          </MenuItem>
        )}
      </MenuContent>
    </Menu>
  )
}

export default function ServiceConnectionSelector({
  service,
  labelledBy,
  describedBy,
  disabled = false,
  onConnect,
  onConnectionChange,
  onReconnect,
  onReplace,
  onRequestReplace,
  onRequestAddApiKey,
  onRemove,
  onRequestRemove,
}: Props) {
  const { t } = useTranslation(['share', 'common'])
  const methodId = useId()
  const selectedNameId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [removal, setRemoval] = useState<Connection | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)
  // Opening an editor transfers focus to it instead of restoring the closing popover trigger.
  const skipReturnFocusRef = useRef(false)
  const [editor, setEditor] = useState<
    { mode: 'add' } | { mode: 'replace'; connection: Connection } | null
  >(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const selectedConnection = service.availableConnections.find(
    (connection) => connection.id === service.selectedConnectionId,
  )
  const selectedStatus = getServiceConnectionStatus(service, selectedConnection)
  const isApiKey = selectedConnection?.method === 'api-key'
  const hasWarning = Boolean(selectedConnection && selectedStatus !== 'connected')
  const requestReplacement = (connection: Connection) => {
    if (disabled || !onReplace) return
    skipReturnFocusRef.current = true
    setOpen(false)
    if (onRequestReplace) {
      onRequestReplace(service.id, connection.id)
      return
    }
    setEditor({ mode: 'replace', connection })
    setEditorOpen(true)
  }

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) skipReturnFocusRef.current = false
          setOpen(nextOpen)
        }}
      >
        <PopoverTrigger
          ref={triggerRef}
          render={<Button variant="ghost" focusableWhenDisabled />}
          disabled={disabled}
          aria-labelledby={labelledBy}
          aria-describedby={
            isApiKey
              ? `${describedBy} ${selectedNameId} ${methodId}`
              : `${describedBy} ${selectedNameId}`
          }
          className={cn(
            'flex h-8 w-40 max-w-full items-center gap-1 rounded-lg bg-components-input-bg-normal px-2 system-sm-regular text-components-input-text-filled hover:bg-state-base-hover-alt data-popup-open:bg-state-base-hover-alt',
            'data-disabled:cursor-not-allowed data-disabled:bg-components-input-bg-disabled data-disabled:text-components-input-text-filled-disabled data-disabled:hover:bg-components-input-bg-disabled',
            isApiKey && 'w-50',
            isApiKey && disabled && 'opacity-45',
            hasWarning &&
              'bg-state-warning-hover inset-ring-1 inset-ring-text-warning hover:bg-state-warning-hover data-popup-open:bg-state-warning-hover',
          )}
        >
          {hasWarning && (
            <span
              className="i-ri-alert-fill size-4 shrink-0 text-text-warning"
              aria-hidden="true"
            />
          )}
          <span
            id={selectedNameId}
            className={cn('min-w-0 flex-1 truncate text-start', !isApiKey && 'px-1')}
          >
            {selectedConnection?.name ??
              t(($) => $['connections.setup.selectConnection'], { ns: 'share' })}
          </span>
          {isApiKey && (
            <span id={methodId} className="shrink-0">
              <Badge
                as="span"
                size="xs"
                variant="dimm"
                uppercase={false}
                className="min-w-4.5 px-1.25 py-0.75 text-[10px] leading-3 font-medium"
              >
                {t(($) => $['connections.setup.apiKey'], { ns: 'share' })}
              </Badge>
            </span>
          )}
          <span
            className="i-ri-arrow-down-s-line size-4 shrink-0 text-text-quaternary"
            aria-hidden="true"
          />
        </PopoverTrigger>
        <PopoverContent
          finalFocus={() => (skipReturnFocusRef.current ? false : triggerRef.current)}
          side="bottom"
          align="end"
          sideOffset={4}
          aria-label={
            isApiKey
              ? t(($) => $['connections.apiKeys.title'], { ns: 'share', provider: service.name })
              : t(($) => $['connections.accounts.title'], { ns: 'share', provider: service.name })
          }
          className="w-90 max-w-(--available-width) p-1"
        >
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto overscroll-contain">
            {service.availableConnections.map((connection) => {
              const connectionStatus = getServiceConnectionStatus(service, connection)
              const expired = connectionStatus === 'reconnect_required'
              const invalid = connectionStatus === 'invalid'
              const invalidApiKey = invalid && connection.method === 'api-key'
              const unavailable = connectionStatus !== 'connected'
              const selected = connection.id === service.selectedConnectionId
              const accountLabelId = `${methodId}-${encodeURIComponent(connection.id)}`
              return (
                <li
                  key={connection.id}
                  aria-label={connection.name}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg px-1 py-0.5 hover:bg-state-base-hover',
                    unavailable ? 'min-h-13' : 'min-h-9',
                  )}
                >
                  {unavailable ? (
                    <>
                      <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        <SelectionMark selected={selected} />
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <span
                            id={accountLabelId}
                            className="truncate system-sm-regular text-text-primary"
                          >
                            {connection.name}
                          </span>
                          <span className="system-xs-regular text-text-warning">
                            {connectionStatus === null
                              ? t(($) => $['api.actionFailed'], { ns: 'common' })
                              : connectionStatus === 'disconnected'
                                ? t(($) => $['connections.setup.selectConnection'], { ns: 'share' })
                                : invalidApiKey
                                  ? t(($) => $['connections.apiKeys.invalid'], { ns: 'share' })
                                  : t(($) => $['connections.accounts.reconnectRequired'], {
                                      ns: 'share',
                                    })}
                          </span>
                        </div>
                      </div>
                      {invalidApiKey ? (
                        <PopoverClose
                          render={<Button size="small" variant="secondary-accent" />}
                          disabled={disabled || !onReplace}
                          aria-describedby={accountLabelId}
                          onClick={() => requestReplacement(connection)}
                        >
                          {t(($) => $['connections.apiKeys.replace'], { ns: 'share' })}
                        </PopoverClose>
                      ) : expired || invalid ? (
                        <Button
                          size="small"
                          variant="secondary-accent"
                          disabled={disabled || !onReconnect}
                          aria-describedby={accountLabelId}
                          onClick={async () => {
                            try {
                              await onReconnect?.(service.id, connection.id)
                            } catch (error) {
                              reportClientError(error)
                            }
                          }}
                        >
                          {t(($) => $['connections.accounts.reconnect'], { ns: 'share' })}
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    <PopoverClose
                      render={
                        <Button
                          variant="ghost"
                          disabled={disabled}
                          className="h-8 min-w-0 flex-1 justify-start px-0 system-sm-regular"
                        />
                      }
                      aria-pressed={selected}
                      onClick={() => onConnectionChange(service.id, connection.id)}
                    >
                      <SelectionMark selected={selected} />
                      <span className="min-w-0 flex-1 truncate text-start">{connection.name}</span>
                    </PopoverClose>
                  )}
                  <AccountActions
                    connection={connection}
                    serviceId={service.id}
                    disabled={disabled}
                    returnFocus={triggerRef}
                    onReconnect={onReconnect}
                    onRequestReplace={onReplace ? () => requestReplacement(connection) : undefined}
                    onRequestRemove={
                      onRemove
                        ? () => {
                            skipReturnFocusRef.current = true
                            setOpen(false)
                            if (onRequestRemove) {
                              onRequestRemove(connection.id)
                              return
                            }
                            setRemoval(connection)
                            setRemoveOpen(true)
                          }
                        : undefined
                    }
                  />
                </li>
              )
            })}
          </ul>
          <div className="mt-1 flex flex-col border-t border-divider-regular pt-1">
            {service.methods.includes('oauth') && (
              <PopoverClose
                render={
                  <Button variant="ghost" disabled={disabled} className="justify-start px-2" />
                }
                onClick={async () => {
                  try {
                    await onConnect(service.id, 'oauth')
                  } catch (error) {
                    reportClientError(error)
                  }
                }}
              >
                <span className="i-ri-add-line size-4" aria-hidden="true" />
                {t(($) => $['connections.accounts.addAccount'], { ns: 'share' })}
              </PopoverClose>
            )}
            {service.methods.includes('api-key') && (
              <PopoverClose
                render={
                  <Button variant="ghost" disabled={disabled} className="justify-start px-2" />
                }
                onClick={() => {
                  if (disabled) return
                  skipReturnFocusRef.current = true
                  if (onRequestAddApiKey) {
                    onRequestAddApiKey(service.id)
                    return
                  }
                  setEditor({ mode: 'add' })
                  setEditorOpen(true)
                }}
              >
                <span className="i-ri-add-line size-4" aria-hidden="true" />
                {t(($) => $['connections.setup.addApiKey'], { ns: 'share' })}
              </PopoverClose>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {editor && (
        <ApiKeyDialog
          serviceId={service.id}
          schemas={service.apiKeySchema}
          key={editor.mode === 'replace' ? editor.connection.id : 'add'}
          mode={editor.mode}
          connectionName={editor.mode === 'replace' ? editor.connection.name : undefined}
          open={editorOpen}
          onOpenChange={setEditorOpen}
          onCloseComplete={() => setEditor(null)}
          onSave={(values) =>
            editor.mode === 'add'
              ? onConnect(service.id, 'api-key', values)
              : onReplace?.(service.id, editor.connection.id, values)
          }
          finalFocus={triggerRef}
          disabled={disabled || (editor.mode === 'replace' && !onReplace)}
        />
      )}
      {removal && (
        <RemoveConnectionDialog
          key={removal.id}
          name={removal.name}
          method={removal.method}
          open={removeOpen}
          onOpenChange={setRemoveOpen}
          onConfirm={() => onRemove?.(service.id, removal.id)}
          finalFocus={triggerRef}
          disabled={disabled || !onRemove}
        />
      )}
    </>
  )
}
