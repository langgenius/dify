'use client'

import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'

type ConfirmModalProps = {
  open: boolean
  onConfirm?: () => void
  onOpenChange: (open: boolean) => void
}

export function ConfirmModal({ open, onConfirm, onOpenChange }: ConfirmModalProps) {
  const { t } = useTranslation(['common', 'tools'])

  return (
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal>
      <DialogContent backdropProps={{ forceRender: true }} className="w-150! p-8!">
        <DialogClose
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          className="absolute top-4 right-4 cursor-pointer rounded-md border-none bg-transparent p-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        >
          <span aria-hidden className="i-ri-close-line size-4 text-text-tertiary" />
        </DialogClose>
        <div className="h-12 w-12 rounded-xl border-[0.5px] border-divider-regular bg-background-section p-3 shadow-xl">
          <span
            aria-hidden
            className="i-custom-vender-solid-alertsAndFeedback-alert-triangle h-6 w-6 text-[rgb(247,144,9)]"
          />
        </div>
        <DialogTitle className="relative mt-3 text-xl leading-7.5 font-semibold text-text-primary">
          {t(($) => $['createTool.confirmTitle'], { ns: 'tools' })}
        </DialogTitle>
        <DialogDescription className="my-1 text-sm/5 text-text-tertiary">
          {t(($) => $['createTool.confirmTip'], { ns: 'tools' })}
        </DialogDescription>
        <div className="flex items-center justify-end pt-6">
          <div className="flex items-center">
            <DialogClose render={<Button className="mr-2" />}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </DialogClose>
            <Button variant="primary" tone="destructive" onClick={onConfirm}>
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
