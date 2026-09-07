'use client'
import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { toast } from '@langgenius/dify-ui/toast'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { renameDocumentName } from '@/service/datasets'

type Props = Readonly<{
  datasetId: string
  documentId: string
  name: string
  onClose: () => void
  onSaved: () => void
}>

const RenameModal: FC<Props> = ({ documentId, datasetId, name, onClose, onSaved }) => {
  const { t } = useTranslation()

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
      toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
      onSaved()
      onClose()
    } catch (error) {
      if (error) toast.error(error.toString())
    } finally {
      setSaveLoadingFalse()
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="overflow-hidden! border-none text-left align-middle">
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {t(($) => $['list.table.rename'], { ns: 'datasetDocuments' })}
        </DialogTitle>
        <Form onFormSubmit={() => void handleSave()}>
          <Field name="documentName" className="mt-6 gap-0">
            <FieldLabel className="py-0 text-sm leading-5.25 font-medium text-text-primary">
              {t(($) => $['list.table.name'], { ns: 'datasetDocuments' })}
            </FieldLabel>
            <Input
              className="mt-2 h-10"
              value={newName}
              placeholder={t(($) => $['placeholder.input'], { ns: 'common' }) || ''}
              onValueChange={setNewName}
            />
          </Field>

          <div className="mt-10 flex justify-end">
            <Button type="button" className="mr-2 shrink-0" onClick={onClose}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </Button>
            <Button type="submit" variant="primary" className="shrink-0" loading={saveLoading}>
              {t(($) => $['operation.save'], { ns: 'common' })}
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
export default React.memo(RenameModal)
