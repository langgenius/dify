import type { ReactNode } from 'react'
import { useCallback } from 'react'
import { Dialog, DialogContent } from '@/app/components/base/ui/dialog'
import { cn } from '@/utils/classnames'

type DialogProps = {
  className?: string
  children: ReactNode
  show: boolean
  onClose?: () => void
}

const MenuDialog = ({
  className,
  children,
  show,
  onClose,
}: DialogProps) => {
  const close = useCallback(() => onClose?.(), [onClose])

  return (
    <Dialog
      open={show}
      onOpenChange={(open) => {
        if (!open)
          close()
      }}
    >
      <DialogContent
        overlayClassName="bg-transparent"
        className={cn(
          'left-0 top-0 h-full max-h-none w-full max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-none bg-background-sidenav-bg p-0 shadow-none backdrop-blur-md',
          className,
        )}
      >
        <div className="absolute right-0 top-0 h-full w-1/2 bg-components-panel-bg" />
        {children}
      </DialogContent>
    </Dialog>
  )
}

export default MenuDialog
