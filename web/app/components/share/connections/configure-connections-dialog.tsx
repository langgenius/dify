'use client'

import type { DialogHandle } from '@langgenius/dify-ui/dialog'
import type { ComponentProps } from 'react'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ApiKeyDialog from './api-key-dialog'
import RequiredServices from './required-services'

type Props = Omit<
  ComponentProps<typeof RequiredServices>,
  'disabled' | 'onRequestReplace' | 'onRequestAddApiKey' | 'className'
> & {
  handle: DialogHandle<unknown>
  isResponding?: boolean
}

type ApiKeyEditor = {
  serviceId: string
  readmeUrl?: string
} & ({ mode: 'add' } | { mode: 'replace'; connectionId: string; name: string })

export default function ConfigureConnectionsDialog({
  handle,
  services,
  onConnect,
  onConnectionChange,
  onReconnect,
  onReplace,
  onRemove,
  isResponding = false,
}: Props) {
  const { t } = useTranslation(['share', 'common'])
  const [open, setOpen] = useState(false)
  const [apiKeyEditor, setApiKeyEditor] = useState<ApiKeyEditor | null>(null)
  const [apiKeyEditorOpen, setApiKeyEditorOpen] = useState(false)
  const configurationTitleRef = useRef<HTMLHeadingElement>(null)
  const requestReplacement = (serviceId: string, connectionId: string) => {
    if (isResponding || !onReplace) return
    const service = services.find((item) => item.id === serviceId)
    const connection = service?.availableConnections.find((item) => item.id === connectionId)
    if (!connection) return
    setApiKeyEditor({
      mode: 'replace',
      serviceId,
      connectionId,
      name: connection.name,
      readmeUrl: service?.readmeUrl,
    })
    setApiKeyEditorOpen(true)
  }
  const requestAddApiKey = (serviceId: string) => {
    if (isResponding) return
    const service = services.find((item) => item.id === serviceId)
    if (!service?.methods.includes('api-key')) return
    setApiKeyEditor({ mode: 'add', serviceId, readmeUrl: service.readmeUrl })
    setApiKeyEditorOpen(true)
  }

  return (
    <Dialog
      handle={handle}
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) {
          setApiKeyEditor(null)
          setApiKeyEditorOpen(false)
        }
      }}
    >
      <DialogContent className="w-160">
        <DialogHeader>
          <DialogTitle tabIndex={-1} ref={configurationTitleRef}>
            {t(($) => $['connections.configure.title'], { ns: 'share' })}
          </DialogTitle>
          {isResponding && (
            <DialogDescription>
              {t(($) => $['connections.configure.runningDescription'], { ns: 'share' })}
            </DialogDescription>
          )}
          <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <DialogBody>
          <div className="px-1 py-3">
            <RequiredServices
              services={services}
              onConnect={onConnect}
              onConnectionChange={onConnectionChange}
              disabled={isResponding}
              onReconnect={onReconnect}
              onReplace={onReplace}
              onRequestReplace={requestReplacement}
              onRequestAddApiKey={requestAddApiKey}
              onRemove={onRemove}
            />
          </div>
        </DialogBody>
      </DialogContent>
      {apiKeyEditor && (
        <ApiKeyDialog
          key={`${apiKeyEditor.mode}:${apiKeyEditor.serviceId}:${apiKeyEditor.mode === 'replace' ? apiKeyEditor.connectionId : ''}`}
          mode={apiKeyEditor.mode}
          connectionName={apiKeyEditor.mode === 'replace' ? apiKeyEditor.name : ''}
          readmeUrl={apiKeyEditor.readmeUrl}
          open={apiKeyEditorOpen}
          onOpenChange={setApiKeyEditorOpen}
          onCloseComplete={() => setApiKeyEditor(null)}
          onSave={(values) =>
            apiKeyEditor.mode === 'add'
              ? onConnect(apiKeyEditor.serviceId, 'api-key', values)
              : onReplace?.(apiKeyEditor.serviceId, apiKeyEditor.connectionId, values)
          }
          finalFocus={configurationTitleRef}
          disabled={isResponding || (apiKeyEditor.mode === 'replace' && !onReplace)}
        />
      )}
    </Dialog>
  )
}
