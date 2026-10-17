'use client'
import type { Hotkey } from '@tanstack/react-hotkeys'
import type { InputVar } from '@/models/pipeline'
import type { SnippetCanvasData } from '@/models/snippet'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { matchesKeyboardEvent } from '@tanstack/react-hotkeys'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const CREATE_SNIPPET_HOTKEY = 'Mod+Enter' satisfies Hotkey

export type CreateSnippetDialogPayload = {
  name: string
  description: string
  graph: SnippetCanvasData
  input_fields?: InputVar[]
}

type CreateSnippetDialogInitialValue = {
  name?: string
  description?: string
}

type CreateSnippetDialogProps = {
  isOpen: boolean
  selectedGraph?: SnippetCanvasData
  inputFields?: InputVar[]
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
  const nameInputId = useId()
  const descriptionInputId = useId()
  const { t } = useTranslation(['common', 'workflow'])
  const nameInputRef = useRef<HTMLInputElement>(null)
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

    if (!trimmedName || isSubmitting) return

    const payload = {
      name: trimmedName,
      description: trimmedDescription,
      graph: selectedGraph ?? defaultGraph,
      input_fields: inputFields,
    }

    onConfirm(payload)
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent
          onKeyDown={(event) => {
            if (
              !isOpen ||
              isSubmitting ||
              !name.trim() ||
              event.defaultPrevented ||
              event.nativeEvent.isComposing ||
              !(event.target instanceof Node) ||
              !event.currentTarget.contains(event.target) ||
              !matchesKeyboardEvent(event.nativeEvent, CREATE_SNIPPET_HOTKEY)
            )
              return
            event.preventDefault()
            event.stopPropagation()
            if (event.repeat) return
            handleConfirm()
          }}
          initialFocus={nameInputRef}
        >
          <DialogHeader>
            <DialogTitle>
              {title || t(($) => $['snippet.createDialogTitle'], { ns: 'workflow' })}
            </DialogTitle>
            <DialogCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
          </DialogHeader>

          <DialogBody className="space-y-4">
            <div>
              <label
                htmlFor={nameInputId}
                className="mb-1 flex h-6 items-center system-sm-medium text-text-secondary"
              >
                {t(($) => $['snippet.nameLabel'], { ns: 'workflow' })}
              </label>
              <Input
                ref={nameInputRef}
                id={nameInputId}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t(($) => $['snippet.namePlaceholder'], { ns: 'workflow' }) || ''}
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label
                htmlFor={descriptionInputId}
                className="mb-1 flex h-6 items-center system-sm-medium text-text-secondary"
              >
                {t(($) => $['snippet.descriptionLabel'], { ns: 'workflow' })}
              </label>
              <Textarea
                id={descriptionInputId}
                className="resize-none"
                value={description}
                onValueChange={(value) => setDescription(value)}
                placeholder={
                  t(($) => $['snippet.descriptionPlaceholder'], { ns: 'workflow' }) || ''
                }
                disabled={isSubmitting}
              />
            </div>
          </DialogBody>

          <DialogFooter>
            <Button disabled={isSubmitting} onClick={handleClose}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </Button>
            <Button
              variant="primary"
              disabled={!name.trim()}
              loading={isSubmitting}
              onClick={handleConfirm}
            >
              {confirmText || t(($) => $['snippet.confirm'], { ns: 'workflow' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
