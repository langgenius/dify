'use client'
import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type IRenameModalProps = {
  isShow: boolean
  saveLoading: boolean
  name: string
  onClose: () => void
  onSave: (name: string) => void
}

const RenameModal: FC<IRenameModalProps> = ({ isShow, saveLoading, name, onClose, onSave }) => {
  const { t } = useTranslation()
  const [tempName, setTempName] = useState(name)
  const conversationNamePlaceholder =
    t(($) => $['chat.conversationNamePlaceholder'], { ns: 'common' }) || ''

  return (
    <Dialog open={isShow} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {t(($) => $['chat.renameConversation'], { ns: 'common' })}
        </DialogTitle>
        <Form
          onFormSubmit={() => {
            if (!saveLoading) onSave(tempName)
          }}
        >
          <Field name="conversationName" className="mt-6 gap-0">
            <FieldLabel className="py-0 text-sm leading-5.25 font-medium text-text-primary">
              {t(($) => $['chat.conversationName'], { ns: 'common' })}
            </FieldLabel>
            <Input
              className="mt-2 h-10"
              value={tempName}
              onValueChange={setTempName}
              placeholder={conversationNamePlaceholder}
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
