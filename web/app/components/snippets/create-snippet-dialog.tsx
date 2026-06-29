'use client'

import type { SnippetCanvasData, SnippetInputField } from '@/models/snippet'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useKeyPress } from 'ahooks'
import { useCallback, useState } from 'react'
import { useTranslation } from '#i18n'

export type CreateSnippetDialogPayload = {
  name: string
  description: string
  graph: SnippetCanvasData
  input_fields?: SnippetInputField[]
}

type CreateSnippetDialogInitialValue = {
  name?: string
  description?: string
}

type CreateSnippetDialogProps = {
  isOpen: boolean
  selectedGraph?: SnippetCanvasData
  inputFields?: SnippetInputField[]
  onClose: () => void
  onConfirm: (payload: CreateSnippetDialogPayload) => void
  isSubmitting?: boolean
  title?: string
  confirmText?: string
  initialValue?: CreateSnippetDialogInitialValue
}

const defaultGraph: SnippetCanvasData = {
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
}

function CreateSnippetDialog({
  isOpen,
  selectedGraph,
  inputFields,
  onClose,
  onConfirm,
  isSubmitting = false,
  title,
  confirmText,
  initialValue,
}: CreateSnippetDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(initialValue?.name ?? '')
  const [description, setDescription] = useState(initialValue?.description ?? '')

  const resetForm = useCallback(() => {
    setName('')
    setDescription('')
  }, [])

  const handleClose = useCallback(() => {
    resetForm()
    onClose()
  }, [onClose, resetForm])

  const handleConfirm = useCallback(() => {
    const trimmedName = name.trim()
    const trimmedDescription = description.trim()

    if (!trimmedName)
      return

    const payload = {
      name: trimmedName,
      description: trimmedDescription,
      graph: selectedGraph ?? defaultGraph,
      input_fields: inputFields,
    }

    onConfirm(payload)
  }, [description, inputFields, name, onConfirm, selectedGraph])

  useKeyPress(['meta.enter', 'ctrl.enter'], () => {
    if (!isOpen)
      return

    if (isSubmitting)
      return

    handleConfirm()
  })

  return (
    <>
      <Dialog open={isOpen} onOpenChange={open => !open && handleClose()}>
        <DialogContent className="w-120 max-w-120 p-0">
          <DialogCloseButton />

          <div className="px-6 pt-6 pb-3">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">
              {title || t('snippet.createDialogTitle', { ns: 'workflow' })}
            </DialogTitle>
          </div>

          <div className="space-y-4 px-6 py-2">
            <div>
              <div className="mb-1 flex h-6 items-center system-sm-medium text-text-secondary">
                {t('snippet.nameLabel', { ns: 'workflow' })}
              </div>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t('snippet.namePlaceholder', { ns: 'workflow' }) || ''}
                disabled={isSubmitting}
                autoFocus
              />
            </div>

            <div>
              <div className="mb-1 flex h-6 items-center system-sm-medium text-text-secondary">
                {t('snippet.descriptionLabel', { ns: 'workflow' })}
              </div>
              <Textarea
                className="resize-none"
                value={description}
                onValueChange={value => setDescription(value)}
                placeholder={t('snippet.descriptionPlaceholder', { ns: 'workflow' }) || ''}
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 px-6 pb-6">
            <Button disabled={isSubmitting} onClick={handleClose}>
              {t('operation.cancel', { ns: 'common' })}
            </Button>
            <Button
              variant="primary"
              disabled={!name.trim() || isSubmitting}
              loading={isSubmitting}
              onClick={handleConfirm}
            >
              {confirmText || t('snippet.confirm', { ns: 'workflow' })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default CreateSnippetDialog
