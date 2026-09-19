'use client'
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
import { useTranslation } from 'react-i18next'
import { CopyFeedback } from '@/app/components/base/copy-feedback'

type CreatedApiKeyDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: string
}

export function CreatedApiKeyDialog({ open, onOpenChange, value }: CreatedApiKeyDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0">
        <div className="flex flex-col gap-1 px-6 pt-6 pr-14 pb-4">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['apiKeyModal.apiSecretKey'], { ns: 'appApi' })}
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
        <div className="px-6 pb-4">
          <InputGroup>
            <InputGroupInput
              aria-label={t(($) => $['apiKeyModal.secretKey'], { ns: 'appApi' })}
              autoComplete="off"
              className="font-mono"
              readOnly
              spellCheck={false}
              value={value}
            />
            <InputGroupAddon align="inline-end" className="pe-1">
              <CopyFeedback content={value} />
            </InputGroupAddon>
          </InputGroup>
        </div>
        <div className="flex justify-end px-6 pb-6">
          <Button variant="primary" onClick={() => onOpenChange(false)}>
            {t(($) => $['actionMsg.ok'], { ns: 'appApi' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
