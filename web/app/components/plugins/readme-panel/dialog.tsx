'use client'
import type { PluginDetail } from '../types'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useTranslation } from 'react-i18next'
import { ReadmePanelContent } from './content'

type ReadmeDialogProps = {
  detail: PluginDetail
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerId?: string
}

export function ReadmeDialog({ detail, open, onOpenChange, triggerId }: ReadmeDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange} triggerId={triggerId}>
      <DialogContent className="h-[calc(100dvh-16px)] w-full max-w-200 overflow-hidden p-0">
        <ReadmePanelContent
          detail={detail}
          title={
            <DialogTitle className="truncate text-xs font-medium text-text-tertiary uppercase">
              {t(($) => $['readmeInfo.title'], { ns: 'plugin' })}
            </DialogTitle>
          }
          closeButton={
            <DialogClose
              render={
                <IconButton
                  aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                  size="sm"
                  className="static size-8 rounded-lg"
                >
                  <span aria-hidden className="i-ri-close-line size-4" />
                </IconButton>
              }
            />
          }
        />
      </DialogContent>
    </Dialog>
  )
}
