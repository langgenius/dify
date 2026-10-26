'use client'
import type { DocumentWithSegmentsResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { DialogBody, DialogFooter, DialogHeader, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { useBoolean } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { renameDocumentName } from '@/service/datasets'

export type RenameDocumentPayload = Pick<DocumentWithSegmentsResponse, 'id' | 'name'>

export function RenameDocumentForm({
  documentId,
  datasetId,
  name,
  onClose,
  onSaved,
}: {
  documentId: string
  datasetId: string
  name: string
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation(['common', 'datasetDocuments'])

  const [newName, setNewName] = useState(name)
  const [saveLoading, { setTrue: setSaveLoadingTrue, setFalse: setSaveLoadingFalse }] =
    useBoolean(false)

  const handleSave = async () => {
    if (saveLoading) return

    setSaveLoadingTrue()
    try {
      await renameDocumentName({
        datasetId,
        documentId,
        name: newName,
      })
      onSaved()
      onClose()
    } catch (error) {
      if (error) toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaveLoadingFalse()
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t(($) => $['list.table.rename'], { ns: 'datasetDocuments' })}</DialogTitle>
      </DialogHeader>
      <Form className="contents" onFormSubmit={() => void handleSave()}>
        <DialogBody>
          <Field name="documentName">
            <FieldLabel className="text-sm leading-5.25 font-medium text-text-primary">
              {t(($) => $['list.table.name'], { ns: 'datasetDocuments' })}
            </FieldLabel>
            <Input
              className="h-10"
              value={newName}
              placeholder={t(($) => $['placeholder.input'], { ns: 'common' }) || ''}
              onValueChange={setNewName}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button type="button" className="shrink-0" onClick={onClose}>
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </Button>
          <Button type="submit" variant="primary" className="shrink-0" loading={saveLoading}>
            {t(($) => $['operation.save'], { ns: 'common' })}
          </Button>
        </DialogFooter>
      </Form>
    </>
  )
}
