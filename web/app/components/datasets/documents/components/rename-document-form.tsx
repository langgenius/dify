'use client'
import type { DocumentWithSegmentsResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { RefObject } from 'react'
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
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'

export type DocumentToRename = Pick<DocumentWithSegmentsResponse, 'id' | 'name'>

export function RenameDocumentForm({
  document,
  onRenamed,
  datasetId,
  ref,
}: {
  document: DocumentToRename
  onRenamed: () => void
  datasetId: string
  ref: RefObject<HTMLFieldSetElement | null>
}) {
  const { t } = useTranslation(['common', 'datasetDocuments'])
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
          if (rename.isPending) return
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
        <fieldset className="contents" ref={ref} disabled={rename.isPending}>
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
            <Button type="submit" variant="primary" className="shrink-0" loading={rename.isPending}>
              {t(($) => $['operation.save'], { ns: 'common' })}
            </Button>
          </DialogFooter>
        </fieldset>
      </Form>
    </>
  )
}
