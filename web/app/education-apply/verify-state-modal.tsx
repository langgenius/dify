import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import {
  RiExternalLinkLine,
} from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'

type IConfirm = {
  className?: string
  isShow: boolean
  title: string
  content?: React.ReactNode
  onConfirm: () => void
  onCancel: () => void
  maskClosable?: boolean
  email?: string
  showLink?: boolean
  confirmText?: string
}

function Confirm({
  isShow,
  title,
  content,
  onConfirm,
  onCancel,
  maskClosable = true,
  showLink,
  email,
  confirmText,
}: IConfirm) {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const eduDocLink = docLink('/use-dify/workspace/subscription-management#dify-for-education')

  const handleClick = () => {
    window.open(eduDocLink, '_blank', 'noopener,noreferrer')
  }

  return (
    <Dialog
      open={isShow}
      onOpenChange={(open) => {
        if (!open)
          onCancel()
      }}
      disablePointerDismissal={!maskClosable}
    >
      <DialogContent className="w-full max-w-[481px]! overflow-hidden! border-none bg-transparent p-0! shadow-none">
        <div className="shadows-shadow-lg flex max-w-full flex-col items-start rounded-2xl border-[0.5px] border-solid border-components-panel-border bg-components-panel-bg">
          <div className="flex flex-col items-start gap-2 self-stretch pt-6 pr-6 pb-4 pl-6">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">{title}</DialogTitle>
            <div className="w-full system-md-regular text-text-tertiary">{content}</div>
          </div>
          {email && (
            <div className="w-full space-y-1 px-6 py-3">
              <div className="py-1 system-sm-semibold text-text-secondary">{t('emailLabel', { ns: 'education' })}</div>
              <div className="rounded-lg bg-components-input-bg-disabled px-3 py-2 system-sm-regular text-components-input-text-filled-disabled">{email}</div>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 self-stretch p-6">
            <div className="flex items-center gap-1">
              {showLink && (
                <>
                  <a onClick={handleClick} href={eduDocLink} target="_blank" rel="noopener noreferrer" className="cursor-pointer system-xs-regular text-text-accent">{t('learn', { ns: 'education' })}</a>
                  <RiExternalLinkLine className="h-3 w-3 text-text-accent" />
                </>
              )}
            </div>
            <Button variant="primary" className={confirmText ? 'min-w-20!' : 'w-20!'} onClick={onConfirm}>{confirmText || t('operation.ok', { ns: 'common' })}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default React.memo(Confirm)
