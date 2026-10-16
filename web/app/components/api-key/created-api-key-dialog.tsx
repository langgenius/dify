'use client'
import type { AlertDialogContentProps, AlertDialogProps } from '@langgenius/dify-ui/alert-dialog'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyFeedback } from '@/app/components/base/copy-feedback'

type CreatedApiKeyDialogProps = Required<Pick<AlertDialogProps, 'open' | 'onOpenChange'>> &
  Pick<AlertDialogContentProps, 'finalFocus'> & {
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
        className="overflow-hidden"
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(($) => $['apiKeyModal.createdTitle'], { ns: 'appApi' })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {revealOnce
              ? t(($) => $['apiKeyModal.revealOnceTips'], { ns: 'appApi' })
              : t(($) => $['apiKeyModal.generateTips'], { ns: 'appApi' })}
          </AlertDialogDescription>
        </AlertDialogHeader>
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
        <div className="flex justify-end px-6 pb-6">
          <AlertDialogCancelButton variant="primary">
            {t(($) => $['apiKeyModal.saved'], { ns: 'appApi' })}
          </AlertDialogCancelButton>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
