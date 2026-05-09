import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
} from '@langgenius/dify-ui/dialog'
import { useCallback } from 'react'

type DialogProps = {
  className?: string
  children: ReactNode
  show: boolean
  onClose?: () => void
}

const AccessControlDialog = ({
  className,
  children,
  show,
  onClose,
}: DialogProps) => {
  const close = useCallback(() => {
    onClose?.()
  }, [onClose])
  return (
    <Dialog open={show} onOpenChange={open => !open && close()}>
      <DialogContent className={cn('min-h-[323px] w-[600px] p-0', className)}>
        <DialogCloseButton className="top-5 right-5 h-8 w-8" />
        {children}
      </DialogContent>
    </Dialog>
  )
}

export default AccessControlDialog
