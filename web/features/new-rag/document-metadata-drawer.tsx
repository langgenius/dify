'use client'

import type { ReactNode } from 'react'
import type { DocumentMetadataField, DocumentMetadataType } from './documents/metadata/editor-model'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import {
  Drawer,
  DrawerBackdrop,
  DrawerCloseButton,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { Input } from '@langgenius/dify-ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { toast } from '@langgenius/dify-ui/toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useHover } from 'ahooks'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleClient, consoleQuery } from '@/service/client'
import { knowledgeFsMetadataFieldsQueryOptions } from '@/service/knowledge-fs/metadata'
import { DocumentMetadataCreateForm } from './document-metadata-create-form'
import { documentMetadataNameError } from './documents/metadata/editor-model'

const metadataTypeIconClass: Record<DocumentMetadataType, string> = {
  number: 'i-ri-hashtag',
  string: 'i-ri-text-snippet',
  time: 'i-ri-time-line',
}
function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div>
      <div className="py-1 system-sm-semibold text-text-secondary">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  )
}

function CreateMetadataPopover({
  allowedExistingName,
  disabled,
  fields,
  pending,
  onCreate,
}: {
  allowedExistingName?: string
  disabled: boolean
  fields: DocumentMetadataField[]
  pending: boolean
  onCreate: (name: string, type: DocumentMetadataType) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="primary" className="mt-3" disabled={disabled || pending}>
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
          allowedExistingName={allowedExistingName}
          fields={fields}
          pending={pending}
          onClose={() => setOpen(false)}
          onCreate={onCreate}
        />
      </PopoverContent>
    </Popover>
  )
}

function MetadataItem({
  busy,
  canEdit,
  field,
  onDelete,
  onRename,
}: {
  busy: boolean
  canEdit: boolean
  field: DocumentMetadataField
  onDelete: (field: DocumentMetadataField) => Promise<boolean>
  onRename: (field: DocumentMetadataField, name: string) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [name, setName] = useState(field.name)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const isDeleteHovering = useHover(deleteButtonRef)

  return (
    <div
      className={cn(
        canEdit && 'hover:shadow-xs',
        'rounded-md border border-components-panel-border-subtle bg-components-panel-on-panel-item-bg',
        isDeleteHovering && 'border border-state-destructive-border bg-state-destructive-hover',
      )}
    >
      <div className="flex h-8 items-center justify-between px-2">
        <div className="flex h-full min-w-0 items-center space-x-1 text-text-tertiary">
          <span
            className={cn(metadataTypeIconClass[field.type], 'size-4 shrink-0')}
            aria-hidden="true"
          />
          <div className="max-w-62.5 truncate system-sm-medium text-text-primary">{field.name}</div>
          <div className="shrink-0 system-xs-regular">{field.type}</div>
        </div>
        <div className="ml-2 shrink-0 system-xs-regular text-text-tertiary">
          {t(($) => $['metadata.datasetMetadata.values'], {
            ns: 'dataset',
            num: field.count,
          })}
        </div>
        {canEdit && (
          <div className="ml-2 flex shrink-0 items-center space-x-1 text-text-tertiary">
            <button
              type="button"
              aria-label={t(($) => $['operation.edit'], { ns: 'common' })}
              className="cursor-pointer rounded-md border-none bg-transparent p-0.5 hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
              onClick={() => {
                setName(field.name)
                setRenameOpen(true)
              }}
            >
              <span className="i-ri-edit-line size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              ref={deleteButtonRef}
              aria-label={t(($) => $['operation.remove'], { ns: 'common' })}
              className="cursor-pointer rounded-md border-none bg-transparent p-0.5 hover:bg-state-destructive-hover hover:text-text-destructive focus-visible:ring-1 focus-visible:ring-state-destructive-border focus-visible:outline-hidden"
              onClick={() => setDeleteOpen(true)}
            >
              <span className="i-ri-delete-bin-line size-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="overflow-hidden! border-none text-left align-middle">
          <form
            onSubmit={async (event) => {
              event.preventDefault()
              if (!name.trim() || busy) return
              if (await onRename(field, name.trim())) setRenameOpen(false)
            }}
          >
            <DialogTitle className="title-2xl-semi-bold text-text-primary">
              {t(($) => $['metadata.datasetMetadata.rename'], { ns: 'dataset' })}
            </DialogTitle>
            <div className="mt-4">
              <Field label={t(($) => $['metadata.datasetMetadata.name'], { ns: 'dataset' })}>
                <Input
                  aria-label={t(($) => $['metadata.datasetMetadata.name'], { ns: 'dataset' })}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t(($) => $['metadata.datasetMetadata.namePlaceholder'], {
                    ns: 'dataset',
                  })}
                />
              </Field>
            </div>
            <div className="mt-4 flex justify-end">
              <Button className="mr-2" onClick={() => setRenameOpen(false)}>
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </Button>
              <Button disabled={!name.trim()} loading={busy} type="submit" variant="primary">
                {t(($) => $['operation.save'], { ns: 'common' })}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t(($) => $['metadata.datasetMetadata.deleteTitle'], { ns: 'dataset' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t(($) => $['metadata.datasetMetadata.deleteContent'], {
                ns: 'dataset',
                name: field.name,
              })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              disabled={busy}
              onClick={async () => {
                if (await onDelete(field)) setDeleteOpen(false)
              }}
            >
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function DocumentMetadataDrawer({
  knowledgeSpaceId,
  onOpenChange,
  open,
  readOnly,
}: {
  knowledgeSpaceId: string
  onOpenChange: (open: boolean) => void
  open: boolean
  readOnly: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  const metadataFieldsQuery = useQuery({
    ...knowledgeFsMetadataFieldsQueryOptions(knowledgeSpaceId),
    enabled: open,
  })
  const fields = metadataFieldsQuery.data ?? []

  const nameErrorMessage = (error: ReturnType<typeof documentMetadataNameError>) => {
    if (!error) return undefined
    return t(($) => $[`metadata.checkName.${error}`], { max: 255, ns: 'dataset' })
  }

  const mutateField = async (mutation: () => Promise<unknown>) => {
    if (readOnly || pending) return false
    setPending(true)
    try {
      await mutation()
      await queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get.key(),
      })
      await queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.metadata.get.key(),
      })
      return true
    } catch {
      toast.error(t(($) => $['newKnowledge.settings.saveFailed'], { ns: 'dataset' }))
      return false
    } finally {
      setPending(false)
    }
  }

  const createMetadata = async (name: string, type: DocumentMetadataType) => {
    const error = nameErrorMessage(documentMetadataNameError(name, fields))
    if (error) {
      toast.error(error)
      return false
    }
    return mutateField(() =>
      consoleClient.knowledgeFs.spaces.byControlSpaceId.metadata.post({
        body: { name, type },
        params: { control_space_id: knowledgeSpaceId },
      }),
    )
  }

  const renameMetadata = async (field: DocumentMetadataField, name: string) => {
    const error = nameErrorMessage(documentMetadataNameError(name, fields, field.name))
    if (error) {
      toast.error(error)
      return false
    }
    if (name === field.name) return true
    return mutateField(() =>
      consoleClient.knowledgeFs.spaces.byControlSpaceId.metadata.byFieldId.patch({
        body: { expectedRowVersion: field.rowVersion, name },
        params: { control_space_id: knowledgeSpaceId, field_id: field.id },
      }),
    )
  }

  const deleteMetadata = (field: DocumentMetadataField) =>
    mutateField(() =>
      consoleClient.knowledgeFs.spaces.byControlSpaceId.metadata.byFieldId.delete({
        params: { control_space_id: knowledgeSpaceId, field_id: field.id },
        query: { expectedRowVersion: field.rowVersion },
      }),
    )

  return (
    <Drawer open={open} modal swipeDirection="right" onOpenChange={onOpenChange}>
      <DrawerPortal>
        <DrawerBackdrop />
        <DrawerViewport>
          <DrawerPopup className="data-[swipe-direction=right]:top-2 data-[swipe-direction=right]:bottom-2 data-[swipe-direction=right]:h-[calc(100dvh-16px)] data-[swipe-direction=right]:w-full data-[swipe-direction=right]:max-w-105">
            <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
              <div className="flex shrink-0 justify-between px-4 pt-6 pb-4">
                <DrawerTitle className="text-lg/6 font-medium text-text-primary">
                  {t(($) => $['metadata.metadata'], { ns: 'dataset' })}
                </DrawerTitle>
                <DrawerCloseButton
                  aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                  className="size-6 rounded-md"
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
                <div className="system-sm-regular text-text-tertiary">
                  {t(($) => $['metadata.datasetMetadata.description'], { ns: 'dataset' })}
                </div>
                <CreateMetadataPopover
                  disabled={
                    readOnly ||
                    metadataFieldsQuery.isPending ||
                    metadataFieldsQuery.isFetching ||
                    Boolean(metadataFieldsQuery.error)
                  }
                  fields={fields}
                  pending={pending}
                  onCreate={createMetadata}
                />

                {metadataFieldsQuery.error && !metadataFieldsQuery.isFetching && (
                  <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-background-section-burn px-3 py-2">
                    <span className="min-w-0 system-xs-regular text-text-tertiary">
                      {t(($) => $['newKnowledge.documentLoadErrorDescription'], {
                        ns: 'dataset',
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
                    <MetadataItem
                      key={field.id}
                      busy={pending}
                      canEdit={!readOnly}
                      field={field}
                      onDelete={deleteMetadata}
                      onRename={renameMetadata}
                    />
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
