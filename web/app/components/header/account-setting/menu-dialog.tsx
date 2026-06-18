import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { useCallback } from 'react'

type DialogProps = {
  backdropClassName?: string
  className?: string
  children: ReactNode
  show: boolean
  onClose?: () => void
}

const MenuDialog = ({
  backdropClassName,
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
        backdropClassName={cn('z-40 bg-transparent', backdropClassName)}
        className={cn(
          'top-0 left-0 z-40 h-full max-h-none w-full max-w-none translate-x-0 translate-y-0 scale-100 overflow-hidden rounded-none border-none bg-background-sidenav-bg p-0 shadow-none backdrop-blur-md transition-opacity data-ending-style:scale-100 data-starting-style:scale-100',
          className,
        )}
      >
        <div className="absolute top-0 right-0 h-full w-1/2 bg-components-panel-bg" />
        {children}
      </DialogContent>
    </Dialog>
  )
}

export default MenuDialog
