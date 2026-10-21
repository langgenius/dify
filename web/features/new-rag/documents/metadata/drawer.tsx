'use client'

import type { DocumentMetadataField, DocumentMetadataType } from './editor-model'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import {
  Drawer,
  DrawerBackdrop,
  DrawerClose,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValueRawSync, useSetAtom } from 'jotai'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleClient, consoleQuery } from '@/service/console'
import { getHttpErrorStatus } from '@/service/http-error'
import { knowledgeFsMetadataFieldsQueryOptions } from '@/service/knowledge-fs/metadata'
import { documentMetadataAtom, documentsKnowledgeSpaceIdAtom } from '../state/inputs'
import { denyDocumentWriteAtom, documentCanReadAtom, documentCanWriteAtom } from '../state/runtime'
import { DocumentMetadataCreateForm } from './create-form'
import { documentMetadataNameError } from './editor-model'

const metadataTypeIconClass: Record<DocumentMetadataType, string> = {
  number: 'i-ri-hashtag',
  string: 'i-ri-text-snippet',
  time: 'i-ri-time-line',
}
// Requests report failures once through useMetadataFieldMutation, including server messages.
const silentRequest = { context: { silent: true } }

function useMetadataFields() {
  const knowledgeSpaceId = useAtomValueRawSync(documentsKnowledgeSpaceIdAtom)
  const canRead = useAtomValueRawSync(documentCanReadAtom)
  const metadataRequest = useAtomValueRawSync(documentMetadataAtom)
  return useQuery({
    ...knowledgeFsMetadataFieldsQueryOptions(knowledgeSpaceId),
    enabled: metadataRequest === '1' && canRead,
  })
}

function useMetadataFieldMutation() {
  const { t } = useTranslation(['knowledgeSpace', 'dataset', 'common'])
  const queryClient = useQueryClient()
  const knowledgeSpaceId = useAtomValueRawSync(documentsKnowledgeSpaceIdAtom)
  const canWrite = useAtomValueRawSync(documentCanWriteAtom)
  const denyWrite = useSetAtom(denyDocumentWriteAtom)
  const { isPending, mutateAsync } = useMutation({
    mutationFn: (mutation: () => Promise<unknown>) => mutation(),
  })
  const mutate = useCallback(
    async (mutation: () => Promise<unknown>) => {
      if (!canWrite || isPending) return false
      try {
        await mutateAsync(mutation)
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get.key(),
          }),
          queryClient.invalidateQueries({
            queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.metadata.get.key(),
          }),
        ])
        return true
      } catch (error) {
        if (getHttpErrorStatus(error) === 403) denyWrite()
        else
          toast.error(
            getHttpErrorStatus(error) !== undefined && error instanceof Error
              ? error.message
              : t(($) => $['settings.saveFailed'], { ns: 'knowledgeSpace' }),
          )
        return false
      }
    },
    [canWrite, denyWrite, isPending, mutateAsync, queryClient, t],
  )

  return { canWrite, knowledgeSpaceId, mutate, pending: isPending }
}

function CreateMetadataPopover() {
  const { t } = useTranslation(['dataset', 'common'])
  const [open, setOpen] = useState(false)
  const metadataFieldsQuery = useMetadataFields()
  const fields = metadataFieldsQuery.data ?? []
  const catalogUnavailable = Boolean(
    metadataFieldsQuery.isPending || metadataFieldsQuery.isFetching || metadataFieldsQuery.error,
  )
  const { canWrite, knowledgeSpaceId, mutate, pending } = useMetadataFieldMutation()
  // DocumentMetadataCreateForm validates the name against the same fields before submitting.
  const createMetadata = (name: string, type: DocumentMetadataType) =>
    mutate(() =>
      consoleClient.knowledgeFs.spaces.byControlSpaceId.metadata.post(
        {
          body: { name, type },
          params: { control_space_id: knowledgeSpaceId },
        },
        silentRequest,
      ),
    )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="primary"
            className="mt-3"
            disabled={!canWrite || pending || catalogUnavailable}
          >
            <span aria-hidden className="mr-1 i-ri-add-line size-4" />
            {t(($) => $['metadata.datasetMetadata.addMetaData'], { ns: 'dataset' })}
          </Button>
        }
      />
      <PopoverContent
        placement="left-start"
        sideOffset={20}
        alignOffset={-38}
        className="w-[320px]"
      >
        <DocumentMetadataCreateForm
          fields={fields}
          pending={pending}
          onClose={() => setOpen(false)}
          onCreate={createMetadata}
        />
      </PopoverContent>
    </Popover>
  )
}

function MetadataItem({
  field,
  fields,
}: {
  field: DocumentMetadataField
  fields: DocumentMetadataField[]
}) {
  const { t } = useTranslation(['dataset', 'common'])
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [name, setName] = useState(field.name)
  const [nameSubmitted, setNameSubmitted] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const { canWrite: canEdit, knowledgeSpaceId, mutate, pending: busy } = useMetadataFieldMutation()
  const nameErrorKind = documentMetadataNameError(name.trim(), fields, field.name)
  const nameError =
    nameSubmitted && nameErrorKind
      ? t(($) => $[`metadata.checkName.${nameErrorKind}`], { max: 255, ns: 'dataset' })
      : undefined
  const renameMetadata = async (nextName: string) => {
    if (nextName === field.name) return true
    return mutate(() =>
      consoleClient.knowledgeFs.spaces.byControlSpaceId.metadata.byFieldId.patch(
        {
          body: { expectedRowVersion: field.rowVersion, name: nextName },
          params: { control_space_id: knowledgeSpaceId, field_id: field.id },
        },
        silentRequest,
      ),
    )
  }
  const deleteMetadata = () =>
    mutate(() =>
      consoleClient.knowledgeFs.spaces.byControlSpaceId.metadata.byFieldId.delete(
        {
          params: { control_space_id: knowledgeSpaceId, field_id: field.id },
          query: { expectedRowVersion: field.rowVersion },
        },
        silentRequest,
      ),
    )

  return (
    <div
      className={cn(
        canEdit && 'hover:shadow-xs',
        'rounded-md border border-components-panel-border-subtle bg-components-panel-on-panel-item-bg has-[[data-metadata-delete]:hover]:border-state-destructive-border has-[[data-metadata-delete]:hover]:bg-state-destructive-hover',
      )}
    >
      <div className="flex h-8 items-center justify-between px-2">
        <div className="flex h-full min-w-0 items-center space-x-1 text-text-tertiary">
          <span
            className={cn(metadataTypeIconClass[field.type], 'size-4 shrink-0')}
            aria-hidden="true"
          />
          <div className="max-w-62.5 truncate system-sm-medium text-text-primary">{field.name}</div>
          <div className="shrink-0 system-xs-regular">
            {t(($) => $[`metadata.type.${field.type}`], { ns: 'dataset' })}
          </div>
        </div>
        <div className="ml-2 shrink-0 system-xs-regular text-text-tertiary">
          {t(($) => $['metadata.datasetMetadata.values'], {
            ns: 'dataset',
            num: field.count,
          })}
        </div>
        {canEdit && (
          <div className="ml-2 flex shrink-0 items-center space-x-1 text-text-tertiary">
            <IconButton
              size="md"
              aria-label={t(($) => $['operation.edit'], { ns: 'common' })}
              onClick={() => {
                setName(field.name)
                setNameSubmitted(false)
                setRenameOpen(true)
              }}
            >
              <span className="i-ri-edit-line size-4" aria-hidden="true" />
            </IconButton>
            <IconButton
              size="md"
              tone="destructive"
              data-metadata-delete=""
              aria-label={t(($) => $['operation.remove'], { ns: 'common' })}
              onClick={() => setDeleteOpen(true)}
            >
              <span className="i-ri-delete-bin-line size-4" aria-hidden="true" />
            </IconButton>
          </div>
        )}
      </div>

      <Dialog open={renameOpen} onOpenChange={(open) => !busy && setRenameOpen(open)}>
        <DialogContent>
          <form
            className="contents"
            onSubmit={async (event) => {
              event.preventDefault()
              if (busy) return
              setNameSubmitted(true)
              if (nameErrorKind) {
                nameInputRef.current?.focus()
                return
              }
              if (await renameMetadata(name.trim())) setRenameOpen(false)
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {t(($) => $['metadata.datasetMetadata.rename'], { ns: 'dataset' })}
              </DialogTitle>
            </DialogHeader>
            <DialogBody>
              <Field name="name" disabled={busy} invalid={Boolean(nameError)}>
                <FieldLabel className="py-1 system-sm-semibold text-text-secondary">
                  {t(($) => $['metadata.datasetMetadata.name'], { ns: 'dataset' })}
                </FieldLabel>
                <Input
                  ref={nameInputRef}
                  autoComplete="off"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t(($) => $['metadata.datasetMetadata.namePlaceholder'], {
                    ns: 'dataset',
                  })}
                />
                {nameError && <FieldError match>{nameError}</FieldError>}
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button disabled={busy} onClick={() => setRenameOpen(false)}>
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </Button>
              <Button loading={busy} type="submit" variant="primary">
                {t(($) => $['operation.save'], { ns: 'common' })}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={(open) => !busy && setDeleteOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $['metadata.datasetMetadata.deleteTitle'], { ns: 'dataset' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $['metadata.datasetMetadata.deleteContent'], {
                ns: 'dataset',
                name: field.name,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton disabled={busy}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              loading={busy}
              onClick={async () => {
                if (await deleteMetadata()) setDeleteOpen(false)
              }}
            >
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function DocumentMetadataDrawer() {
  const { t } = useTranslation(['dataset', 'common', 'knowledgeCitation'])
  const canRead = useAtomValueRawSync(documentCanReadAtom)
  const metadataRequest = useAtomValueRawSync(documentMetadataAtom)
  const setMetadataRequest = useSetAtom(documentMetadataAtom)
  const open = metadataRequest === '1' && canRead
  const metadataFieldsQuery = useMetadataFields()
  const fields = metadataFieldsQuery.data ?? []

  return (
    <Drawer
      open={open}
      modal
      swipeDirection="right"
      onOpenChange={(nextOpen) => void setMetadataRequest(nextOpen ? '1' : null)}
    >
      <DrawerPortal>
        <DrawerBackdrop />
        <DrawerViewport>
          <DrawerPopup className="data-[swipe-direction=right]:top-2 data-[swipe-direction=right]:bottom-2 data-[swipe-direction=right]:h-[calc(100dvh-16px)] data-[swipe-direction=right]:w-full data-[swipe-direction=right]:max-w-105">
            <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
              <div className="flex shrink-0 justify-between px-4 pt-6 pb-4">
                <DrawerTitle className="text-lg/6 font-medium text-text-primary">
                  {t(($) => $['metadata.metadata'], { ns: 'dataset' })}
                </DrawerTitle>
                <DrawerClose
                  render={
                    <IconButton
                      aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                      size="lg"
                    >
                      <span aria-hidden className="i-ri-close-line size-5" />
                    </IconButton>
                  }
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
                <div className="system-sm-regular text-text-tertiary">
                  {t(($) => $['metadata.datasetMetadata.description'], { ns: 'dataset' })}
                </div>
                <CreateMetadataPopover />

                {metadataFieldsQuery.error && !metadataFieldsQuery.isFetching && (
                  <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-background-section-burn px-3 py-2">
                    <span className="min-w-0 system-xs-regular text-text-tertiary">
                      {t(($) => $.documentLoadErrorDescription, {
                        ns: 'knowledgeCitation',
                      })}
                    </span>
                    <Button
                      className="shrink-0"
                      onClick={() => void metadataFieldsQuery.refetch()}
                      size="small"
                      variant="ghost"
                    >
                      {t(($) => $['operation.retry'], { ns: 'common' })}
                    </Button>
                  </div>
                )}

                <div className="mt-3 space-y-1">
                  {fields.map((field) => (
                    <MetadataItem key={field.id} field={field} fields={fields} />
                  ))}
                </div>
              </div>
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}
