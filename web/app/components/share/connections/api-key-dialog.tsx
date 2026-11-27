'use client'

import type { ProviderConfig } from '@dify/contracts/api/web/types.gen'
import type { DialogContentProps } from '@langgenius/dify-ui/dialog'
import type { ComponentProps } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useQuery } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiKeyForm } from './api-key-form'
import ConnectionLoadState from './connection-load-state'
import { useOptionalWebAppConnections, useWebAppConnections } from './use-connections'

type ApiKeyFormProps = ComponentProps<typeof ApiKeyForm>
type Props = Omit<ApiKeyFormProps, 'onClose' | 'onSavingChange' | 'schemas'> & {
  serviceId: string
  schemas?: ProviderConfig[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseComplete?: () => void
  finalFocus?: DialogContentProps['finalFocus']
}

function SchemaLoadState({
  mode,
  onClose,
  loading,
  error,
  onRetry,
}: Pick<ApiKeyFormProps, 'mode' | 'onClose'> & ComponentProps<typeof ConnectionLoadState>) {
  const { t } = useTranslation(['share', 'common'])
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {mode === 'add'
            ? t(($) => $['connections.setup.addApiKey'], { ns: 'share' })
            : t(($) => $['connections.apiKeys.replaceTitle'], { ns: 'share' })}
        </DialogTitle>
        <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
      </DialogHeader>
      <DialogBody>
        <ConnectionLoadState loading={loading} error={error} onRetry={onRetry} />
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>{t(($) => $['operation.cancel'], { ns: 'common' })}</Button>
      </DialogFooter>
    </>
  )
}

function ConnectedApiKeyForm({
  serviceId,
  ...props
}: Omit<ApiKeyFormProps, 'schemas'> & { serviceId: string }) {
  const connections = useWebAppConnections()
  const query = useQuery(connections.getApiKeySchemaOptions(serviceId))
  if (!query.data || query.isError)
    return (
      <SchemaLoadState
        mode={props.mode}
        onClose={props.onClose}
        loading={query.isPending}
        error={query.isError}
        onRetry={query.isError ? () => void query.refetch() : undefined}
      />
    )
  return (
    <ApiKeyForm
      {...props}
      schemas={query.data}
      readmeService={connections.services.find((service) => service.id === serviceId)}
    />
  )
}

function ApiKeyContent({
  serviceId,
  schemas,
  ...props
}: Omit<ApiKeyFormProps, 'schemas'> & { serviceId: string; schemas?: ProviderConfig[] }) {
  const connections = useOptionalWebAppConnections()
  if (connections) return <ConnectedApiKeyForm {...props} serviceId={serviceId} />
  if (schemas) return <ApiKeyForm {...props} schemas={schemas} />
  return <SchemaLoadState mode={props.mode} onClose={props.onClose} error />
}

export default function ApiKeyDialog({
  mode,
  serviceId,
  schemas,
  connectionName,
  open,
  onOpenChange,
  onCloseComplete,
  onSave,
  finalFocus,
  disabled,
}: Props) {
  const savingRef = useRef(false)
  const contentRef = useRef<HTMLDivElement>(null)

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!savingRef.current) onOpenChange(nextOpen)
      }}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) onCloseComplete?.()
      }}
    >
      <DialogContent
        ref={contentRef}
        initialFocus={() => contentRef.current?.querySelector<HTMLInputElement>('input') ?? false}
        className="w-140"
        finalFocus={finalFocus}
        backdropProps={{ forceRender: true }}
      >
        <ApiKeyContent
          serviceId={serviceId}
          schemas={schemas}
          mode={mode}
          connectionName={connectionName}
          onSave={onSave}
          onClose={() => onOpenChange(false)}
          onSavingChange={(saving) => {
            savingRef.current = saving
          }}
          disabled={disabled}
        />
      </DialogContent>
    </Dialog>
  )
}
