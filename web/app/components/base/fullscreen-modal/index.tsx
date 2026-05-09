import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { RiCloseLargeLine } from '@remixicon/react'
import { noop } from 'es-toolkit/function'

type IModal = {
  className?: string
  wrapperClassName?: string
  open: boolean
  onClose?: () => void
  title?: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  closable?: boolean
  overflowVisible?: boolean
}

export default function FullScreenModal({
  className,
  wrapperClassName,
  open,
  onClose = noop,
  children,
  closable = false,
  overflowVisible = false,
}: IModal) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen)
          onClose()
      }}
    >
      <DialogContent
        backdropProps={{ 'data-testid': 'fullscreen-modal-backdrop' }}
        backdropClassName="bg-background-overlay-backdrop backdrop-blur-[6px]"
        className={cn(
          'top-0 left-0 h-screen w-screen max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-none bg-transparent p-4 shadow-none',
          'max-h-none',
          wrapperClassName,
        )}
      >
        <div
          className="h-full w-full"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          <div className="relative h-full w-full rounded-2xl border border-effects-highlight bg-background-default-subtle">
            <div className={cn('h-full', overflowVisible ? 'overflow-visible' : 'overflow-hidden', className)}>
              {closable
                && (
                  <button
                    type="button"
                    aria-label="Close"
                    className="absolute top-3 right-3 z-50 flex h-9 w-9 cursor-pointer items-center justify-center rounded-[10px] bg-components-button-tertiary-bg hover:bg-components-button-tertiary-bg-hover"
                    onClick={(e) => {
                      e.stopPropagation()
                      onClose()
                    }}
                  >
                    <RiCloseLargeLine className="h-3.5 w-3.5 text-components-button-tertiary-text" />
                  </button>
                )}
              {children}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
