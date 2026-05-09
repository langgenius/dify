import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { RiCloseLine } from '@remixicon/react'
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
    <Dialog open={show} disablePointerDismissal>
      <DialogContent
        className={cn(
          'h-auto max-h-none min-h-[323px] w-[600px] max-w-none overflow-y-auto rounded-2xl border-none bg-components-panel-bg p-0 shadow-xl transition-all',
          className,
        )}
      >
        <button
          type="button"
          aria-label="Close"
          className="absolute top-5 right-5 z-10 flex h-8 w-8 cursor-pointer items-center justify-center"
          onClick={close}
        >
          <RiCloseLine className="h-5 w-5 text-text-tertiary" />
        </button>
        {children}
      </DialogContent>
    </Dialog>
  )
}

export default AccessControlDialog
