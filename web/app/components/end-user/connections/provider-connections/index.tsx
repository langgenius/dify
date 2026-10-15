'use client'

import type { ConnectionProvider, EndUserConnection } from '../model'
import { Avatar, AvatarFallback } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getAvatarInitial } from '@/utils/avatar'
import EmptyState from '../../empty-state'
import LinkedAppsPopover from './linked-apps-popover'
import RemoveConnectionDialog from './remove-connection-dialog'

type Props = {
  provider: ConnectionProvider
  connections: readonly EndUserConnection[]
  onRemove: (connection: EndUserConnection) => void | Promise<void>
}

type ConnectionRowProps = {
  connection: EndUserConnection
  onRequestRemoval: (connection: EndUserConnection, trigger: HTMLButtonElement) => void
}

function ConnectionRow({ connection, onRequestRemoval }: ConnectionRowProps) {
  const { t } = useTranslation(['app'])
  const connectionLabelId = useId()

  return (
    <tr className="h-20">
      <th scope="row" className="px-2 py-4 pl-4 text-left align-middle">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar size="sm" aria-hidden>
            <AvatarFallback className="bg-components-icon-bg-blue-soft system-sm-semibold text-text-accent">
              {getAvatarInitial(connection.name)}
            </AvatarFallback>
          </Avatar>
          <span
            id={connectionLabelId}
            className="min-w-0 system-sm-semibold leading-4.5 wrap-anywhere text-text-secondary"
          >
            {connection.name}
          </span>
        </div>
      </th>
      <td className="px-2 py-4 align-middle">
        <LinkedAppsPopover connection={connection} connectionLabelId={connectionLabelId} />
      </td>
      <td className="px-2 py-4 align-middle system-xs-medium text-text-accent">
        {connection.type === 'oauth'
          ? t(($) => $['endUser.oauthAccount'], { ns: 'app' })
          : t(($) => $['endUser.apiKey'], { ns: 'app' })}
      </td>
      <td className="px-2 py-4 pr-4 text-right align-middle">
        <Button
          variant="secondary"
          tone="destructive"
          onClick={(event) => onRequestRemoval(connection, event.currentTarget)}
        >
          {connection.type === 'oauth'
            ? t(($) => $['endUser.disconnect'], { ns: 'app' })
            : t(($) => $['endUser.deleteKey'], { ns: 'app' })}
        </Button>
      </td>
    </tr>
  )
}

export default function ProviderConnections({ provider, connections, onRemove }: Props) {
  const { t } = useTranslation(['app'])
  const [removal, setRemoval] = useState<EndUserConnection | null>(null)
  const [removalOpen, setRemovalOpen] = useState(false)
  const removalTriggerRef = useRef<HTMLButtonElement | null>(null)
  const removalSucceededRef = useRef(false)
  const captionRef = useRef<HTMLTableCaptionElement>(null)

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-components-panel-border bg-components-panel-bg shadow-xs">
        <table className="w-full min-w-180 table-fixed border-collapse has-[caption:focus-visible]:inset-ring-2 has-[caption:focus-visible]:inset-ring-state-accent-solid">
          <caption ref={captionRef} tabIndex={-1} className="sr-only">
            {provider.name}
          </caption>
          <colgroup>
            <col className="w-76" />
            <col />
            <col />
            <col className="w-54" />
          </colgroup>
          <thead className="border-b border-divider-subtle bg-background-gradient-mask-gray">
            <tr className="system-xs-medium leading-4 text-text-tertiary">
              <th scope="col" className="px-2 py-3 pl-4 text-left font-medium">
                {t(($) => $['endUser.connection'], { ns: 'app' })}
              </th>
              <th scope="col" className="px-2 py-3 text-left font-medium">
                {t(($) => $['endUser.linkedApps'], { ns: 'app' })}
              </th>
              <th scope="col" className="px-2 py-3 text-left font-medium">
                {t(($) => $['endUser.connectionType'], { ns: 'app' })}
              </th>
              <th scope="col" className="px-2 py-3 pr-4 text-right font-medium">
                {t(($) => $['endUser.connectionActions'], { ns: 'app' })}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider-subtle">
            {connections.length > 0 ? (
              connections.map((connection) => (
                <ConnectionRow
                  key={connection.id}
                  connection={connection}
                  onRequestRemoval={(connection, trigger) => {
                    removalTriggerRef.current = trigger
                    removalSucceededRef.current = false
                    setRemoval(connection)
                    setRemovalOpen(true)
                  }}
                />
              ))
            ) : (
              <tr>
                <td colSpan={4} className="px-4 py-8">
                  <EmptyState
                    title={t(($) => $['endUser.noProviderConnections'], { ns: 'app' })}
                    description={t(($) => $['endUser.noProviderConnectionsDescription'], {
                      ns: 'app',
                      provider: provider.name,
                    })}
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <RemoveConnectionDialog
        connection={removal}
        open={removalOpen}
        finalFocus={() => {
          if (removalSucceededRef.current) return captionRef.current ?? true
          return removalTriggerRef.current?.isConnected ? removalTriggerRef.current : true
        }}
        onOpenChange={setRemovalOpen}
        onCloseComplete={() => setRemoval(null)}
        onRemove={async (connection) => {
          await onRemove(connection)
          removalSucceededRef.current = true
        }}
      />
    </>
  )
}
