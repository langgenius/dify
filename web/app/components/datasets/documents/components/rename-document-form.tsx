'use client'
import type { DocumentWithSegmentsResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { Ref } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import {
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { useIsMutating, useMutation } from '@tanstack/react-query'
import { useImperativeHandle } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { documentRenameFilter } from '@/service/datasets'

export type DocumentToRename = Pick<DocumentWithSegmentsResponse, 'id' | 'name'>

export function RenameDocumentForm({
  document,
  activeDocumentIdRef,
  onRenamed,
  datasetId,
}: {
  document: DocumentToRename
  activeDocumentIdRef?: Ref<string>
  onRenamed: () => void
  datasetId: string
}) {
  const { t } = useTranslation(['common', 'datasetDocuments'])
  useImperativeHandle(activeDocumentIdRef, () => document.id, [document.id])
  const saving = useIsMutating(documentRenameFilter(datasetId, document.id)) > 0
  const rename = useMutation(
    consoleQuery.datasets.byDatasetId.documents.byDocumentId.rename.post.mutationOptions({
      context: { silent: true },
    }),
  )
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t(($) => $['list.table.rename'], { ns: 'datasetDocuments' })}</DialogTitle>
      </DialogHeader>
      <Form<{ documentName: string }>
        className="contents"
        onFormSubmit={({ documentName }) => {
          if (saving) return
          rename.mutate(
            {
              params: { dataset_id: datasetId, document_id: document.id },
              body: { name: documentName },
            },
            {
              onSuccess: onRenamed,
              onError: (error) =>
                toast.error(error instanceof Error ? error.message : String(error)),
            },
          )
        }}
      >
        <fieldset className="contents" disabled={saving}>
          <DialogBody>
            <Field name="documentName">
              <FieldLabel className="text-sm leading-5.25 font-medium text-text-primary">
                {t(($) => $['list.table.name'], { ns: 'datasetDocuments' })}
              </FieldLabel>
              <Input
                className="h-10"
                defaultValue={document.name}
                placeholder={t(($) => $['placeholder.input'], { ns: 'common' })}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button className="shrink-0" />}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </DialogClose>
            <Button type="submit" variant="primary" className="shrink-0" loading={saving}>
              {t(($) => $['operation.save'], { ns: 'common' })}
            </Button>
          </DialogFooter>
        </fieldset>
      </Form>
    </>
  )
}
