'use client'
import type { DocumentWithSegmentsResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { DialogHandle } from '@langgenius/dify-ui/dialog'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
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

export type RenameDocumentPayload = Pick<DocumentWithSegmentsResponse, 'id' | 'name'>

export function RenameDocumentDialog({
  handle,
  datasetId,
  onSaved,
}: {
  handle: DialogHandle<RenameDocumentPayload>
  datasetId: string
  onSaved: () => void
}) {
  const { t } = useTranslation(['common', 'datasetDocuments'])
  const rename = useMutation(
    consoleQuery.datasets.byDatasetId.documents.byDocumentId.rename.post.mutationOptions({
      context: { silent: true },
      onSuccess: () => onSaved(),
      onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
    }),
  )
  return (
    <Dialog
      handle={handle}
      onOpenChange={(open, details) => {
        if (open) rename.reset()
        else if (rename.isPending && details.reason !== 'imperative-action') details.cancel()
      }}
    >
      {({ payload }) =>
        payload && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t(($) => $['list.table.rename'], { ns: 'datasetDocuments' })}
              </DialogTitle>
            </DialogHeader>
            <Form<{ documentName: string }>
              key={payload.id}
              className="contents"
              onFormSubmit={({ documentName }) => {
                if (rename.isPending) return
                rename.mutate(
                  {
                    params: { dataset_id: datasetId, document_id: payload.id },
                    body: { name: documentName },
                  },
                  { onSuccess: () => handle.close() },
                )
              }}
            >
              <DialogBody>
                <Field name="documentName">
                  <FieldLabel className="text-sm leading-5.25 font-medium text-text-primary">
                    {t(($) => $['list.table.name'], { ns: 'datasetDocuments' })}
                  </FieldLabel>
                  <Input
                    className="h-10"
                    defaultValue={payload.name}
                    disabled={rename.isPending}
                    placeholder={t(($) => $['placeholder.input'], { ns: 'common' })}
                  />
                </Field>
              </DialogBody>
              <DialogFooter>
                <DialogClose render={<Button className="shrink-0" disabled={rename.isPending} />}>
                  {t(($) => $['operation.cancel'], { ns: 'common' })}
                </DialogClose>
                <Button
                  type="submit"
                  variant="primary"
                  className="shrink-0"
                  loading={rename.isPending}
                >
                  {t(($) => $['operation.save'], { ns: 'common' })}
                </Button>
              </DialogFooter>
            </Form>
          </DialogContent>
        )
      }
    </Dialog>
  )
}
