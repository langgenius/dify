'use client'

import type { MetadataArgs } from '@dify/contracts/api/console/datasets/types.gen'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Input } from '@langgenius/dify-ui/input'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'

// This session is mounted for one dataset. Server fields stay in Query; only the
// submitted field has a local draft. External providers own the actual values.
const ExternalMetadataSection = ({
  datasetId,
  readonly,
}: {
  datasetId: string
  readonly: boolean
}) => {
  const { t } = useTranslation(['dataset', 'common'])
  const nameId = useId()
  const typeId = useId()
  const params = { dataset_id: datasetId }
  const query = useQuery(
    consoleQuery.datasets.byDatasetId.metadata.get.queryOptions({ input: { params } }),
  )
  const create = useMutation(consoleQuery.datasets.byDatasetId.metadata.post.mutationOptions())
  const rename = useMutation(
    consoleQuery.datasets.byDatasetId.metadata.byMetadataId.patch.mutationOptions(),
  )
  const remove = useMutation(
    consoleQuery.datasets.byDatasetId.metadata.byMetadataId.delete.mutationOptions(),
  )
  const [deleting, setDeleting] = useState<{ id: string; name: string }>()
  const [name, setName] = useState('')
  const [type, setType] = useState<MetadataArgs['type']>('string')
  const [editingId, setEditingId] = useState<string>()
  const pending = create.isPending || rename.isPending || remove.isPending
  const mutationError = create.error || rename.error || remove.error
  const clearErrors = () => {
    create.reset()
    rename.reset()
    remove.reset()
  }
  const resetDraft = () => {
    clearErrors()
    setName('')
    setEditingId(undefined)
  }

  return (
    <section className="space-y-3" aria-labelledby={`${nameId}-heading`}>
      <h3 id={`${nameId}-heading`} className="system-sm-semibold text-text-secondary">
        {t(($) => $['metadata.metadata'], { ns: 'dataset' })}
      </h3>
      <p className="text-sm text-text-tertiary">
        {t(($) => $['metadata.externalDescription'], { ns: 'dataset' })}
      </p>
      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !pending) setDeleting(undefined)
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>
            {t(($) => $['metadata.datasetMetadata.deleteTitle'], { ns: 'dataset' })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(($) => $['metadata.datasetMetadata.deleteContent'], {
              ns: 'dataset',
              name: deleting?.name ?? '',
            })}
          </AlertDialogDescription>
          {remove.error && <div role="alert">{remove.error.message}</div>}
          <AlertDialogFooter>
            <AlertDialogCancelButton disabled={pending}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                if (!deleting || pending) return
                remove.mutate(
                  { params: { ...params, metadata_id: deleting.id } },
                  {
                    onSuccess: () => {
                      if (editingId === deleting.id) resetDraft()
                      setDeleting(undefined)
                    },
                  },
                )
              }}
            >
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {query.isPending && <div role="status">{t(($) => $.loading, { ns: 'common' })}</div>}
      {query.isError && (
        <div role="alert">
          {query.error.message}
          <Button onClick={() => query.refetch()}>
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        </div>
      )}
      {query.data && (
        <>
          <ul className="space-y-2">
            {query.data.doc_metadata.map((field) => (
              <li key={field.id} className="flex flex-wrap items-center gap-2">
                <span className="grow text-sm text-text-secondary">
                  {field.name} ({field.type})
                </span>
                {!readonly && (
                  <>
                    <Button
                      size="small"
                      disabled={pending}
                      onClick={() => {
                        clearErrors()
                        setEditingId(field.id)
                        setName(field.name)
                      }}
                    >
                      {t(($) => $['operation.edit'], { ns: 'common' })}
                    </Button>
                    <Button
                      size="small"
                      disabled={pending}
                      onClick={() => {
                        clearErrors()
                        setDeleting(field)
                      }}
                    >
                      {t(($) => $['operation.remove'], { ns: 'common' })}
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {!readonly && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                if (pending || !name.trim()) return
                clearErrors()
                const body = { name: name.trim() }
                if (editingId)
                  rename.mutate(
                    { params: { ...params, metadata_id: editingId }, body },
                    { onSuccess: resetDraft },
                  )
                else create.mutate({ params, body: { ...body, type } }, { onSuccess: resetDraft })
              }}
            >
              <div className="space-y-1">
                <label htmlFor={nameId}>
                  {t(($) => $['metadata.createMetadata.name'], { ns: 'dataset' })}
                </label>
                <Input
                  id={nameId}
                  required
                  maxLength={255}
                  value={name}
                  disabled={pending}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              {!editingId && (
                <div className="space-y-1">
                  <label htmlFor={typeId}>
                    {t(($) => $['metadata.createMetadata.type'], { ns: 'dataset' })}
                  </label>
                  <select
                    id={typeId}
                    value={type}
                    disabled={pending}
                    onChange={(event) => setType(event.target.value as MetadataArgs['type'])}
                    className="block rounded-md bg-components-input-bg-normal p-2 focus-visible:outline-2"
                  >
                    <option value="string">String</option>
                    <option value="number">Number</option>
                    <option value="time">Time</option>
                  </select>
                </div>
              )}
              <Button type="submit" loading={pending} disabled={!name.trim()}>
                {t(($) => $['operation.save'], { ns: 'common' })}
              </Button>
              {editingId && (
                <Button disabled={pending} onClick={resetDraft}>
                  {t(($) => $['operation.cancel'], { ns: 'common' })}
                </Button>
              )}
            </form>
          )}
          {mutationError && !deleting && <div role="alert">{mutationError.message}</div>}
        </>
      )}
    </section>
  )
}

export default ExternalMetadataSection
