'use client'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { renameDocumentName } from '@/service/datasets'

type Props = Readonly<{
  datasetId: string
  documentId: string
  name: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}>

export function RenameModal({ documentId, datasetId, name, open, onOpenChange, onSaved }: Props) {
  const { t } = useTranslation(['common'])
  const [saveLoading, setSaveLoading] = useState(false)

  const handleSave = async (newName: string) => {
    if (saveLoading) return

    setSaveLoading(true)
    try {
      await renameDocumentName({
        datasetId,
        documentId,
        name: newName,
      })
      toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
      onSaved()
      onOpenChange(false)
    } catch (error) {
      if (error) toast.error(error.toString())
    } finally {
      setSaveLoading(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (saveLoading) {
          details.cancel()
          return
        }
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="overflow-hidden! border-none text-left align-middle">
        <RenameForm name={name} saveLoading={saveLoading} onSave={handleSave} />
      </DialogContent>
    </Dialog>
  )
}

function RenameForm({
  name,
  saveLoading,
  onSave,
}: {
  name: string
  saveLoading: boolean
  onSave: (name: string) => Promise<void>
}) {
  const { t } = useTranslation(['common', 'datasetDocuments'])
  const [newName, setNewName] = useState(name)

  return (
    <>
      <DialogTitle className="title-2xl-semi-bold text-text-primary">
        {t(($) => $['list.table.rename'], { ns: 'datasetDocuments' })}
      </DialogTitle>
      <Form onFormSubmit={() => void onSave(newName)}>
        <Field name="documentName" className="mt-6">
          <FieldLabel className="text-sm leading-5.25 font-medium text-text-primary">
            {t(($) => $['list.table.name'], { ns: 'datasetDocuments' })}
          </FieldLabel>
          <Input
            className="h-10"
            value={newName}
            readOnly={saveLoading}
            placeholder={t(($) => $['placeholder.input'], { ns: 'common' }) || ''}
            onValueChange={setNewName}
          />
        </Field>

        <div className="mt-10 flex justify-end">
          <DialogClose disabled={saveLoading} render={<Button className="mr-2 shrink-0" />}>
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </DialogClose>
          <Button type="submit" variant="primary" className="shrink-0" loading={saveLoading}>
            {t(($) => $['operation.save'], { ns: 'common' })}
          </Button>
        </div>
      </Form>
    </>
  )
}
