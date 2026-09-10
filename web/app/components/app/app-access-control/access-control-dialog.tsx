import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogClose, DialogContent } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

type DialogProps = {
  className?: string
  children: ReactNode
  show: boolean
  onClose?: () => void
}

const AccessControlDialog = ({ className, children, show, onClose }: DialogProps) => {
  const { t } = useTranslation()
  const close = useCallback(() => {
    onClose?.()
  }, [onClose])

  return (
    <Dialog open={show} disablePointerDismissal onOpenChange={(open) => !open && close()}>
      <DialogContent
        className={cn(
          'h-auto max-h-[calc(100dvh-2rem)] min-h-80.75 w-150 max-w-none overflow-y-auto rounded-2xl border-none bg-components-panel-bg p-0 shadow-xl transition-all',
          className,
        )}
      >
        <DialogClose
          render={
            <IconButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              size="lg"
              className="absolute top-5 right-5"
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </IconButton>
          }
        />
        {children}
      </DialogContent>
    </Dialog>
  )
}

export default AccessControlDialog
