'use client'

import type { PluginDetail } from '../types'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'
import { ReadmePanelContent } from './content'

type ReadmeDialogProps = {
  detail: PluginDetail
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerId?: string
}

export function ReadmeDialog({
  detail,
  open,
  onOpenChange,
  triggerId,
}: ReadmeDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      triggerId={triggerId}
    >
      <DialogContent className="h-[calc(100dvh-16px)] w-full max-w-200 overflow-hidden p-0">
        <ReadmePanelContent
          detail={detail}
          title={(
            <DialogTitle className="truncate text-xs font-medium text-text-tertiary uppercase">
              {t('readmeInfo.title', { ns: 'plugin' })}
            </DialogTitle>
          )}
          closeButton={(
            <DialogCloseButton
              aria-label={t('operation.close', { ns: 'common' })}
              className="static h-8 w-8 rounded-lg"
            />
          )}
        />
      </DialogContent>
    </Dialog>
  )
}
