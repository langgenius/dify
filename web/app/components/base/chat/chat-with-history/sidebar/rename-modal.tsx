'use client'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { useTranslation } from 'react-i18next'

type RenameConversationDialogProps = {
  open: boolean
  saveLoading: boolean
  name: string
  onOpenChange: (open: boolean) => void
  onSave: (name: string) => void
}

export function RenameConversationDialog({
  open,
  saveLoading,
  name,
  onOpenChange,
  onSave,
}: RenameConversationDialogProps) {
  const { t } = useTranslation(['common'])
  const conversationNamePlaceholder =
    t(($) => $['chat.conversationNamePlaceholder'], { ns: 'common' }) || ''

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (saveLoading) details.cancel()
        else onOpenChange(nextOpen)
      }}
    >
      <DialogContent>
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {t(($) => $['chat.renameConversation'], { ns: 'common' })}
        </DialogTitle>
        <Form<{ conversationName: string }>
          onFormSubmit={({ conversationName }) => {
            if (!saveLoading) onSave(conversationName)
          }}
        >
          <Field name="conversationName" className="mt-6">
            <FieldLabel className="text-sm leading-5.25 font-medium text-text-primary">
              {t(($) => $['chat.conversationName'], { ns: 'common' })}
            </FieldLabel>
            <Input
              className="h-10"
              defaultValue={name}
              readOnly={saveLoading}
              placeholder={conversationNamePlaceholder}
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
      </DialogContent>
    </Dialog>
  )
}
