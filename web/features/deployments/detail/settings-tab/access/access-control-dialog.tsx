import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
} from '@langgenius/dify-ui/dialog'

type DialogProps = {
  className?: string
  children: ReactNode
  show: boolean
  onClose?: () => void
}

export function AccessControlDialog({
  className,
  children,
  show,
  onClose,
}: DialogProps) {
  return (
    <Dialog open={show} disablePointerDismissal onOpenChange={open => !open && onClose?.()}>
      <DialogContent
        className={cn(
          'h-auto max-h-[calc(100dvh-2rem)] min-h-[323px] w-[600px] max-w-none overflow-y-auto rounded-2xl border-none bg-components-panel-bg p-0 shadow-xl transition-shadow',
          className,
        )}
      >
        <DialogCloseButton className="top-5 right-5 size-8" />
        {children}
      </DialogContent>
    </Dialog>
  )
}
