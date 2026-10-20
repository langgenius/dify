'use client'
import type { DialogContentProps, DialogProps } from '@langgenius/dify-ui/dialog'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
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
  const { t } = useTranslation(['appApi'])
  const copyButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <Dialog open={open} disablePointerDismissal onOpenChange={onOpenChange}>
      <DialogContent
        initialFocus={copyButtonRef}
        finalFocus={finalFocus}
        backdropProps={{ forceRender: true }}
      >
        <DialogHeader>
          <DialogTitle>{t(($) => $['apiKeyModal.createdTitle'], { ns: 'appApi' })}</DialogTitle>
          <DialogDescription>
            {revealOnce
              ? t(($) => $['apiKeyModal.revealOnceTips'], { ns: 'appApi' })
              : t(($) => $['apiKeyModal.generateTips'], { ns: 'appApi' })}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
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
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="primary" />}>
            {t(($) => $['apiKeyModal.saved'], { ns: 'appApi' })}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
