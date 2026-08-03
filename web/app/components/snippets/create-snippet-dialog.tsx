'use client'

import type { Hotkey } from '@tanstack/react-hotkeys'
import type { SnippetCanvasData, SnippetInputField } from '@/models/snippet'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBackdrop,
  DialogCloseButton,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const CREATE_SNIPPET_HOTKEY = 'Mod+Enter' satisfies Hotkey

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

export function CreateSnippetDialog({
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
  const popupRef = useRef<HTMLDivElement>(null)
  const [name, setName] = useState(initialValue?.name ?? '')
  const [description, setDescription] = useState(initialValue?.description ?? '')

  function resetForm() {
    setName('')
    setDescription('')
  }

  function handleClose() {
    resetForm()
    onClose()
  }

  function handleConfirm() {
    const trimmedName = name.trim()
    const trimmedDescription = description.trim()

    if (!trimmedName) return

    const payload = {
      name: trimmedName,
      description: trimmedDescription,
      graph: selectedGraph ?? defaultGraph,
      input_fields: inputFields,
    }

    onConfirm(payload)
  }

  useHotkey(CREATE_SNIPPET_HOTKEY, handleConfirm, {
    enabled: isOpen && !isSubmitting,
    ignoreInputs: false,
    preventDefault: false,
    stopPropagation: false,
    target: popupRef,
  })

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogPortal>
          <DialogBackdrop />
          <DialogPopup
            ref={popupRef}
            className="fixed top-1/2 left-1/2 max-h-[80dvh] w-120 max-w-120 -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain p-0"
          >
            <DialogCloseButton />

            <div className="px-6 pt-6 pb-3">
              <DialogTitle className="title-2xl-semi-bold text-text-primary">
                {title || t(($) => $['snippet.createDialogTitle'], { ns: 'workflow' })}
              </DialogTitle>
            </div>

            <div className="space-y-4 px-6 py-2">
              <div>
                <div className="mb-1 flex h-6 items-center system-sm-medium text-text-secondary">
                  {t(($) => $['snippet.nameLabel'], { ns: 'workflow' })}
                </div>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t(($) => $['snippet.namePlaceholder'], { ns: 'workflow' }) || ''}
                  disabled={isSubmitting}
                  autoFocus
                />
              </div>

              <div>
                <div className="mb-1 flex h-6 items-center system-sm-medium text-text-secondary">
                  {t(($) => $['snippet.descriptionLabel'], { ns: 'workflow' })}
                </div>
                <Textarea
                  className="resize-none"
                  value={description}
                  onValueChange={(value) => setDescription(value)}
                  placeholder={
                    t(($) => $['snippet.descriptionPlaceholder'], { ns: 'workflow' }) || ''
                  }
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-6 pb-6">
              <Button disabled={isSubmitting} onClick={handleClose}>
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </Button>
              <Button
                variant="primary"
                disabled={!name.trim() || isSubmitting}
                loading={isSubmitting}
                onClick={handleConfirm}
              >
                {confirmText || t(($) => $['snippet.confirm'], { ns: 'workflow' })}
              </Button>
            </div>
          </DialogPopup>
        </DialogPortal>
      </Dialog>
    </>
  )
}
