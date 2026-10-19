'use client'

import type { RefObject } from 'react'
import type { ApiKeyValues } from './api-key-dialog'
import type { RequiredConnectionService } from './required-services'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import ApiKeyDialog from './api-key-dialog'

export type ConnectionActions = {
  onReconnect?: (serviceId: string, connectionId: string) => void
  onReplace?: (
    serviceId: string,
    connectionId: string,
    values: ApiKeyValues,
  ) => void | Promise<void>
  onRemove?: (serviceId: string, connectionId: string) => void
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
  onRemove,
}: ConnectionActions & {
  connection: Connection
  serviceId: string
  disabled?: boolean
  returnFocus: RefObject<HTMLButtonElement | null>
}) {
  const { t } = useTranslation(['share'])
  const canReconnect =
    !!onReconnect && connection.method !== 'api-key' && connection.status !== 'expired'
  if (!onRemove && !canReconnect) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton
            size="md"
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
      <DropdownMenuContent className="w-50 max-w-(--available-width)" finalFocus={returnFocus}>
        {canReconnect && (
          <DropdownMenuItem
            disabled={disabled}
            onClick={() => onReconnect?.(serviceId, connection.id)}
          >
            {t(($) => $['connections.accounts.reconnect'], { ns: 'share' })}
          </DropdownMenuItem>
        )}
        {onRemove && (
          <DropdownMenuItem
            variant="destructive"
            disabled={disabled}
            onClick={() => onRemove(serviceId, connection.id)}
          >
            {connection.method === 'api-key'
              ? t(($) => $['connections.apiKeys.remove'], { ns: 'share' })
              : t(($) => $['connections.accounts.remove'], { ns: 'share' })}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
}: Props) {
  const { t } = useTranslation(['share'])
  const methodId = useId()
  const selectedNameId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [editor, setEditor] = useState<
    { mode: 'add' } | { mode: 'replace'; connection: Connection } | null
  >(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const selectedConnection = service.availableConnections.find(
    (connection) => connection.id === service.selectedConnectionId,
  )
  const isExpired = selectedConnection?.status === 'expired'
  const isApiKey = selectedConnection?.method === 'api-key'
  const hasWarning = isExpired || selectedConnection?.status === 'invalid'

  return (
    <>
      <Popover>
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
          placement="bottom-end"
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
              const expired = connection.status === 'expired'
              const invalid = connection.status === 'invalid'
              const unavailable = expired || invalid
              const selected = connection.id === service.selectedConnectionId
              const accountLabelId = `${methodId}-${encodeURIComponent(connection.id)}`
              return (
                <li
                  key={connection.id}
                  aria-label={connection.name}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg px-1 py-0.5 hover:bg-state-base-hover',
                    unavailable ? 'min-h-13' : 'min-h-11',
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
                            {invalid
                              ? t(($) => $['connections.apiKeys.invalid'], { ns: 'share' })
                              : t(($) => $['connections.accounts.reconnectRequired'], {
                                  ns: 'share',
                                })}
                          </span>
                        </div>
                      </div>
                      {invalid ? (
                        <PopoverClose
                          render={<Button size="small" variant="secondary-accent" />}
                          disabled={disabled || !onReplace}
                          aria-describedby={accountLabelId}
                          onClick={() => {
                            if (disabled || !onReplace) return
                            if (onRequestReplace) {
                              onRequestReplace(service.id, connection.id)
                              return
                            }
                            setEditor({ mode: 'replace', connection })
                            setEditorOpen(true)
                          }}
                        >
                          {t(($) => $['connections.apiKeys.replace'], { ns: 'share' })}
                        </PopoverClose>
                      ) : (
                        <Button
                          size="small"
                          variant="secondary-accent"
                          disabled={disabled || !onReconnect}
                          aria-describedby={accountLabelId}
                          onClick={() => onReconnect?.(service.id, connection.id)}
                        >
                          {t(($) => $['connections.accounts.reconnect'], { ns: 'share' })}
                        </Button>
                      )}
                    </>
                  ) : (
                    <PopoverClose
                      render={
                        <Button
                          variant="ghost"
                          disabled={disabled}
                          className="min-h-10 min-w-0 flex-1 justify-start px-0 system-sm-regular"
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
                    onRemove={onRemove}
                  />
                </li>
              )
            })}
          </ul>
          <div className="mt-1 flex flex-col border-t border-divider-regular pt-1">
            {service.methods.includes('oauth') && !isApiKey && (
              <PopoverClose
                render={
                  <Button variant="ghost" disabled={disabled} className="justify-start px-2" />
                }
                onClick={() => onConnect(service.id, 'oauth')}
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
          key={editor.mode === 'replace' ? editor.connection.id : 'add'}
          mode={editor.mode}
          connectionName={editor.mode === 'replace' ? editor.connection.name : undefined}
          readmeUrl={service.readmeUrl}
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
    </>
  )
}
