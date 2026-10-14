'use client'
import type { DialogContentProps, DialogProps } from '@langgenius/dify-ui/dialog'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyFeedback } from '@/app/components/base/copy-feedback'

type CreatedApiKeyDialogProps = Required<Pick<DialogProps, 'open' | 'onOpenChange'>> &
  Pick<DialogContentProps, 'finalFocus'> & {
    value: string | undefined
    revealOnce?: boolean
  }

export function CreatedApiKeyDialog({
  open,
  onOpenChange,
  value,
  finalFocus,
  revealOnce = false,
}: CreatedApiKeyDialogProps) {
  const { t } = useTranslation(['appApi', 'common'])
  const copyButtonRef = useRef<HTMLButtonElement>(null)

  const keyField = (
    <div className="px-6 pb-4">
      <InputGroup>
        <InputGroupInput
          aria-label={t(($) => $['apiKeyModal.secretKey'], { ns: 'appApi' })}
          autoComplete="off"
          className="font-mono"
          readOnly
          spellCheck={false}
          value={value ?? ''}
        />
        <InputGroupAddon align="inline-end" className="pe-1">
          <CopyFeedback ref={copyButtonRef} content={value ?? ''} />
        </InputGroupAddon>
      </InputGroup>
    </div>
  )

  if (!revealOnce) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          initialFocus={copyButtonRef}
          finalFocus={finalFocus}
          backdropProps={{ forceRender: true }}
          className="overflow-hidden p-0"
        >
          <div className="flex flex-col gap-1 px-6 pt-6 pr-14 pb-4">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">
              {t(($) => $['apiKeyModal.createdTitle'], { ns: 'appApi' })}
            </DialogTitle>
            <DialogDescription className="system-sm-regular text-text-tertiary">
              {t(($) => $['apiKeyModal.generateTips'], { ns: 'appApi' })}
            </DialogDescription>
          </div>
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
          {keyField}
          <div className="flex justify-end px-6 pb-6">
            <DialogClose render={<Button variant="primary" />}>
              {t(($) => $['operation.close'], { ns: 'common' })}
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && details.reason === 'escape-key') details.cancel()
        else onOpenChange(nextOpen, details)
      }}
    >
      <AlertDialogContent
        initialFocus={copyButtonRef}
        finalFocus={finalFocus}
        backdropProps={{ forceRender: true }}
        className="overflow-hidden p-0"
      >
        <div className="flex flex-col gap-1 px-6 pt-6 pb-4">
          <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['apiKeyModal.createdTitle'], { ns: 'appApi' })}
          </AlertDialogTitle>
          <AlertDialogDescription className="system-sm-regular text-text-tertiary">
            {t(($) => $['apiKeyModal.revealOnceTips'], { ns: 'appApi' })}
          </AlertDialogDescription>
        </div>
        {keyField}
        <div className="flex justify-end px-6 pb-6">
          <AlertDialogCancelButton variant="primary">
            {t(($) => $['apiKeyModal.saved'], { ns: 'appApi' })}
          </AlertDialogCancelButton>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
