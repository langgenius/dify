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
import { ApiKeyForm } from './api-key-dialog'
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
  const apiKeySavingRef = useRef(false)
  const returnToConfigurationRef = useRef(false)
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
  }
  const requestAddApiKey = (serviceId: string) => {
    if (isResponding) return
    const service = services.find((item) => item.id === serviceId)
    if (!service?.methods.includes('api-key')) return
    setApiKeyEditor({ mode: 'add', serviceId, readmeUrl: service.readmeUrl })
  }
  const showConfiguration = () => {
    if (apiKeySavingRef.current) return
    returnToConfigurationRef.current = true
    setApiKeyEditor(null)
  }

  return (
    <Dialog
      handle={handle}
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && apiKeyEditor) {
          details.cancel()
          showConfiguration()
          return
        }
        setOpen(nextOpen)
      }}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) {
          setApiKeyEditor(null)
          returnToConfigurationRef.current = false
        }
      }}
    >
      <DialogContent className={apiKeyEditor ? 'w-140' : 'w-160'}>
        {apiKeyEditor ? (
          <ApiKeyForm
            key={`${apiKeyEditor.mode}:${apiKeyEditor.serviceId}:${apiKeyEditor.mode === 'replace' ? apiKeyEditor.connectionId : ''}`}
            mode={apiKeyEditor.mode}
            connectionName={apiKeyEditor.mode === 'replace' ? apiKeyEditor.name : ''}
            readmeUrl={apiKeyEditor.readmeUrl}
            onSave={(values) =>
              apiKeyEditor.mode === 'add'
                ? onConnect(apiKeyEditor.serviceId, 'api-key', values)
                : onReplace?.(apiKeyEditor.serviceId, apiKeyEditor.connectionId, values)
            }
            onClose={showConfiguration}
            onSavingChange={(saving) => {
              apiKeySavingRef.current = saving
            }}
            disabled={isResponding || (apiKeyEditor.mode === 'replace' && !onReplace)}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle
                tabIndex={-1}
                ref={(element) => {
                  if (element && returnToConfigurationRef.current) {
                    element.focus()
                    returnToConfigurationRef.current = false
                  }
                }}
              >
                {t(($) => $['connections.configure.title'], { ns: 'share' })}
              </DialogTitle>
              {isResponding && (
                <DialogDescription>
                  {t(($) => $['connections.configure.runningDescription'], { ns: 'share' })}
                </DialogDescription>
              )}
              <DialogHeaderCloseButton
                aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              />
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
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
