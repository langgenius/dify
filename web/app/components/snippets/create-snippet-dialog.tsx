'use client'
import type { Hotkey } from '@tanstack/react-hotkeys'
import type { SnippetCanvasData, SnippetInputField } from '@/models/snippet'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
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
  input_fields?: SnippetInputField[]
}

type CreateSnippetDialogInitialValue = {
  name?: string
  description?: string
}

type CreateSnippetDialogProps = {
  open: boolean
  selectedGraph?: SnippetCanvasData
  inputFields?: SnippetInputField[]
  onOpenChange: (open: boolean) => void
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

export function CreateSnippetDialog({ open, onOpenChange, ...props }: CreateSnippetDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop />
        <CreateSnippetPopup open={open} {...props} />
      </DialogPortal>
    </Dialog>
  )
}

function CreateSnippetPopup({
  open,
  selectedGraph,
  inputFields,
  onConfirm,
  isSubmitting = false,
  title,
  confirmText,
  initialValue,
}: Omit<CreateSnippetDialogProps, 'onOpenChange'>) {
  const nameInputId = useId()
  const descriptionInputId = useId()
  const { t } = useTranslation(['common', 'workflow'])
  const nameInputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(initialValue?.name ?? '')
  const [description, setDescription] = useState(initialValue?.description ?? '')

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
    <DialogPopup
      onKeyDown={(event) => {
        if (
          !open ||
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
      className="fixed top-1/2 left-1/2 max-h-[80dvh] w-120 max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain p-0"
    >
      <DialogClose
        render={
          <IconButton
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            size="lg"
            className="absolute inset-e-6 top-6"
          >
            <span aria-hidden className="i-ri-close-line size-4" />
          </IconButton>
        }
      />

      <div className="px-6 pt-6 pb-3">
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {title || t(($) => $['snippet.createDialogTitle'], { ns: 'workflow' })}
        </DialogTitle>
      </div>

      <div className="space-y-4 px-6 py-2">
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
            placeholder={t(($) => $['snippet.descriptionPlaceholder'], { ns: 'workflow' }) || ''}
            disabled={isSubmitting}
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 px-6 pb-6">
        <DialogClose disabled={isSubmitting} render={<Button />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button
          variant="primary"
          disabled={!name.trim()}
          loading={isSubmitting}
          onClick={handleConfirm}
        >
          {confirmText || t(($) => $['snippet.confirm'], { ns: 'workflow' })}
        </Button>
      </div>
    </DialogPopup>
  )
}
