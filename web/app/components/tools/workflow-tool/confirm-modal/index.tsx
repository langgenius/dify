'use client'

import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'

type ConfirmModalProps = {
  show: boolean
  onConfirm?: () => void
  onClose: () => void
}

const ConfirmModal = ({ show, onConfirm, onClose }: ConfirmModalProps) => {
  const { t } = useTranslation(['common', 'tools'])

  return (
    <Dialog
      open={show}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      disablePointerDismissal
    >
      <DialogContent backdropProps={{ forceRender: true }} className="w-150 max-w-150">
        <DialogHeader>
          <div className="mb-2 h-12 w-12 rounded-xl border-[0.5px] border-divider-regular bg-background-section p-3 shadow-xl">
            <span
              aria-hidden
              className="i-custom-vender-solid-alertsAndFeedback-alert-triangle h-6 w-6 text-[rgb(247,144,9)]"
            />
          </div>
          <DialogTitle>{t(($) => $['createTool.confirmTitle'], { ns: 'tools' })}</DialogTitle>
          <DialogDescription>
            {t(($) => $['createTool.confirmTip'], { ns: 'tools' })}
          </DialogDescription>
          <DialogCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onClose}>{t(($) => $['operation.cancel'], { ns: 'common' })}</Button>
          <Button variant="primary" tone="destructive" onClick={onConfirm}>
            {t(($) => $['operation.confirm'], { ns: 'common' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ConfirmModal
